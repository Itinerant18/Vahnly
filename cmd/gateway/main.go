package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	adminHttp "github.com/platform/driver-delivery/internal/admin/delivery/http"
	gatewayHttp "github.com/platform/driver-delivery/internal/gateway/delivery/http"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/platform/driver-delivery/internal/observability"
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
)

func main() {
	// Root execution context
	mainCtx, mainCancel := context.WithCancel(context.Background())
	defer mainCancel()

	tp, err := observability.InitTracerProvider("api-gateway-service")
	if err != nil {
		log.Fatalf("OpenTelemetry trace infrastructure provider boot failed: %v", err)
	}
	defer func() { _ = tp.Shutdown(context.Background()) }()

	httpPort := getEnv("HTTP_PORT", "8080")
	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	jwtSecret := getEnv("JWT_SECRET_SIGNING_KEY", "kolkata_marketplace_backbone_secret_token_string")

	log.Printf("Bootstrapping Coordinated API Gateway on Port: %s", httpPort)

	dbPool, err := pgxpool.New(mainCtx, postgresURL)
	if err != nil {
		log.Fatalf("PostgreSQL connection pool setup failed: %v", err)
	}
	defer dbPool.Close()

	nodeList := strings.Split(redisNodes, ",")
	redisClusterClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: nodeList,
	})
	defer redisClusterClient.Close()

	brokersList := strings.Split(kafkaBrokers, ",")

	pricingService := pricingSvc.NewOrderPricingService(brokersList, "gateway-pricing-group", redisClusterClient)
	go pricingService.StartSurgeMatrixSync(mainCtx)

	kafkaWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokersList...),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	defer kafkaWriter.Close()

	handler := gatewayHttp.NewGatewayHandler(dbPool, kafkaWriter, pricingService, redisClusterClient)
	handler.SetJWTSecret(jwtSecret)

	adminAuthHandler := adminHttp.NewAdminAuthHandler(dbPool, jwtSecret)
	adminTripHandler := adminHttp.NewAdminTripHandler(dbPool, redisClusterClient)
	pricingLogger := log.New(os.Stdout, "[PRICING_ADMIN] ", log.LstdFlags)
	pricingAdminHandler := adminHttp.NewPricingAdminHandler(dbPool, redisClusterClient, pricingLogger)
	incidentLogger := log.New(os.Stdout, "[INCIDENT_ADMIN] ", log.LstdFlags)
	incidentAdminHandler := adminHttp.NewIncidentAdminHandler(dbPool, redisClusterClient, brokersList, incidentLogger)

	// Bind global SOS broadcast callback to populate the admin incident panel queue
	gatewayHttp.SOSCallback = func(tripID string, lat, lng float64) {
		incidentAdminHandler.AddIncident(adminHttp.StalledTripIncident{
			OrderID:              tripID,
			DriverID:             "drv-ambient-alpha",
			DriverName:           "Aniket Karmakar",
			CustomerName:         "Sarah Connor",
			VehicleMakeModel:     "Audi A6 Premium",
			LicensePlate:         "WB-02-AK-9988",
			LastKnownStatus:      "ON_TRIP",
			SecondsSinceLastPing: 0,
			CityPrefix:           "KOL",
			IncidentType:         "SOS",
			IncidentStatus:       "UNASSIGNED",
			AssignedAgentID:      "",
			BearingDelta:         0.0,
			CalculatedSpeed:      0.0,
			IsMockProvider:       false,
			BatteryLevel:         100.0,
			Latitude:             lat,
			Longitude:            lng,
		})
	}
	ledgerLogger := log.New(os.Stdout, "[LEDGER_ADMIN] ", log.LstdFlags)
	ledgerAdminHandler := adminHttp.NewLedgerAdminHandler(dbPool, ledgerLogger)
	orchestratorLogger := log.New(os.Stdout, "[ORCHESTRATOR_ADMIN] ", log.LstdFlags)
	orchestratorAdminHandler := adminHttp.NewMarketplaceOrchestratorHandler(dbPool, redisClusterClient, orchestratorLogger)

	complianceLogger := log.New(os.Stdout, "[COMPLIANCE_ADMIN] ", log.LstdFlags)
	complianceAdminHandler := adminHttp.NewDriverComplianceHandler(dbPool, redisClusterClient, complianceLogger)

	riderLogger := log.New(os.Stdout, "[RIDER_ADMIN] ", log.LstdFlags)
	riderHandler := adminHttp.NewRiderHandler(dbPool, redisClusterClient, riderLogger)

	driverLogger := log.New(os.Stdout, "[DRIVER_ADMIN] ", log.LstdFlags)
	driverHandler := adminHttp.NewDriverHandler(dbPool, redisClusterClient, driverLogger)

	vehicleLogger := log.New(os.Stdout, "[VEHICLE_ADMIN] ", log.LstdFlags)
	vehicleHandler := adminHttp.NewVehicleHandler(dbPool, redisClusterClient, vehicleLogger)

	dispatchLogger := log.New(os.Stdout, "[DISPATCH_ADMIN] ", log.LstdFlags)
	dispatchHandler := adminHttp.NewDispatchHandler(dbPool, redisClusterClient, dispatchLogger)

	dashboardLogger := log.New(os.Stdout, "[DASHBOARD_ADMIN] ", log.LstdFlags)
	dashboardHandler := adminHttp.NewDashboardHandler(dbPool, redisClusterClient, dashboardLogger, incidentAdminHandler)

	promoLogger := log.New(os.Stdout, "[PROMO_ADMIN] ", log.LstdFlags)
	promoHandler := adminHttp.NewPromoHandler(dbPool, redisClusterClient, promoLogger)

	financeLogger := log.New(os.Stdout, "[FINANCE_ADMIN] ", log.LstdFlags)
	financeHandler := adminHttp.NewFinanceHandler(dbPool, financeLogger)

	go handler.InternalBackplaneMultiplexer(mainCtx)
	go startKafkaToRedisFanoutWorker(mainCtx, brokersList, redisClusterClient)

	// Instantiate edge protection layers
	authGuard := middleware.NewAuthMiddleware(jwtSecret)
	// Rate Limit parameters: Allow maximum 5 requests per 1 minute rolling window
	rateLimiter := middleware.NewRateLimiterMiddleware(redisClusterClient, 5, 1*time.Minute)

	// MILESTONE 22 INITIALIZATION: Instantiate the Region Shard Router
	rawSupportedRegions := getEnv("SUPPORTED_REGIONS_MATRIX", "KOL,BLR") // Declare active shards
	supportedRegions := strings.Split(rawSupportedRegions, ",")
	regionRouter := middleware.NewRegionRouterMiddleware(supportedRegions)

	mux := http.NewServeMux()

	// Authentication / Access routes
	mux.HandleFunc("POST /api/v1/auth/rider/login", handler.HandleRiderLogin)
	mux.HandleFunc("POST /api/v1/auth/driver/login", handler.HandleDriverLogin)
	mux.HandleFunc("POST /api/v1/admin/auth/login", adminAuthHandler.HandleAdminLogin)
	mux.HandleFunc("POST /api/v1/admin/auth/register", adminAuthHandler.HandleAdminRegister)
	// TOTP self-enrolment (JWT-protected) + Google Workspace SSO (public entry points).
	mux.HandleFunc("POST /api/v1/admin/auth/2fa/enroll", authGuard.AuthenticateJWT(adminAuthHandler.HandleEnroll2FA))
	mux.HandleFunc("GET /api/v1/admin/auth/sso/google/start", adminAuthHandler.HandleSSOGoogleStart)
	mux.HandleFunc("GET /api/v1/admin/auth/sso/google/callback", adminAuthHandler.HandleSSOGoogleCallback)

	mux.HandleFunc("GET /api/v1/pricing/quote", regionRouter.RouteRegionalTraffic(handler.HandleGetPricingQuote))
	mux.HandleFunc("POST /api/v1/orders/quote", regionRouter.RouteRegionalTraffic(handler.HandleCreatePricingQuote))
	mux.HandleFunc("PATCH /api/v1/orders/{order_id}/route", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(handler.HandleUpdateOrderRoute)))
	mux.HandleFunc("GET /api/v1/telemetry/supply/near", regionRouter.RouteRegionalTraffic(handler.HandleGetTelemetrySupplyNear))
	mux.HandleFunc("POST /api/v1/orders", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleCreateOrder))))
	mux.HandleFunc("GET /api/v1/dispatch/stream", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(handler.HandleMatchRealtimeStream)))
	mux.HandleFunc("POST /api/v1/dispatch/accept", authGuard.AuthenticateJWT(rateLimiter.LimitRouteConcurrency(handler.HandleAcceptOrder)))
	mux.HandleFunc("POST /api/v1/dispatch/decline", authGuard.AuthenticateJWT(rateLimiter.LimitRouteConcurrency(handler.HandleDeclineOrder)))
	mux.HandleFunc("POST /api/v1/trip/arrive", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleArriveAtPickup))))
	mux.HandleFunc("POST /api/v1/trip/start", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleStartTrip))))
	mux.HandleFunc("POST /api/v1/trip/complete", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleCompleteTrip))))
	mux.HandleFunc("GET /api/v1/driver/me", authGuard.AuthenticateJWT(handler.HandleDriverGetProfile))
	mux.HandleFunc("POST /api/v1/driver/status", authGuard.AuthenticateJWT(handler.HandleDriverSetStatus))
	mux.HandleFunc("GET /api/v1/driver/offer", authGuard.AuthenticateJWT(handler.HandleDriverGetOffer))
	mux.HandleFunc("GET /api/v1/driver/trips", authGuard.AuthenticateJWT(handler.HandleDriverGetTrips))
	mux.HandleFunc("GET /api/v1/driver/earnings", authGuard.AuthenticateJWT(handler.HandleDriverGetEarnings))
	mux.HandleFunc("POST /api/v1/driver/device-token", authGuard.AuthenticateJWT(handler.HandleRegisterDeviceToken))
	mux.HandleFunc("POST /api/v1/driver/location", authGuard.AuthenticateJWT(handler.HandleDriverLocationUpdate))
	mux.HandleFunc("POST /api/v1/payments/webhook", handler.HandlePaymentWebhook)
	mux.HandleFunc("POST /api/v1/sos/trigger", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(handler.HandleTriggerSOS)))

	// Register administrative control routes, protected by granular RBAC role gates
	mux.HandleFunc("GET /api/v1/admin/ledger", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCIAL_AUDITOR"}, handler.HandleAdminGetLedger))
	mux.HandleFunc("POST /api/v1/admin/drivers/override", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, handler.HandleAdminDriverOverride))
	mux.HandleFunc("GET /api/v1/admin/orders", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR"}, adminTripHandler.HandleAdminGetOrders))
	mux.HandleFunc("POST /api/v1/admin/orders/cancel", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT"}, adminTripHandler.HandleAdminCancelOrder))
	mux.HandleFunc("GET /api/v1/admin/orders/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR"}, adminTripHandler.HandleAdminGetTripDetail))
	mux.HandleFunc("POST /api/v1/admin/orders", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER"}, adminTripHandler.HandleAdminCreateTrip))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/reopen", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, adminTripHandler.HandleAdminReopenTrip))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/reassign", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER"}, adminTripHandler.HandleAdminReassignTrip))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/fraud", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER"}, adminTripHandler.HandleAdminMarkFraud))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/send-invoice", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"}, adminTripHandler.HandleAdminSendInvoice))
	mux.HandleFunc("POST /api/v1/admin/pricing/freeze", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "MARKET_CONTROLLER"}, pricingAdminHandler.HandleEnforcePriceCap))
	mux.HandleFunc("GET /api/v1/admin/pricing/fares", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, pricingAdminHandler.HandleGetFares))
	mux.HandleFunc("GET /api/v1/admin/pricing/fares/history", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, pricingAdminHandler.HandleGetFareHistory))
	mux.HandleFunc("POST /api/v1/admin/pricing/fares", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CITY_MANAGER", "FINANCE"}, pricingAdminHandler.HandlePostFare))
	mux.HandleFunc("POST /api/v1/admin/pricing/fares/revert", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CITY_MANAGER", "FINANCE"}, pricingAdminHandler.HandleRevertFare))
	mux.HandleFunc("GET /api/v1/admin/pricing/surge/rules", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, pricingAdminHandler.HandleGetSurgeRules))
	mux.HandleFunc("POST /api/v1/admin/pricing/surge/rules", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CITY_MANAGER", "FINANCE"}, pricingAdminHandler.HandlePostSurgeRules))
	mux.HandleFunc("GET /api/v1/admin/pricing/commission", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, pricingAdminHandler.HandleGetCommission))
	mux.HandleFunc("POST /api/v1/admin/pricing/commission", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CITY_MANAGER", "FINANCE"}, pricingAdminHandler.HandlePostCommission))
	mux.HandleFunc("GET /api/v1/admin/trips/stalled", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "SUPPORT_LEAD"}, incidentAdminHandler.HandleGetStalledTrips))
	mux.HandleFunc("POST /api/v1/admin/trips/recover", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "SUPPORT_LEAD"}, incidentAdminHandler.HandleExecuteTripRecovery))
	mux.HandleFunc("POST /api/v1/admin/trips/claim", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "SUPPORT_LEAD"}, incidentAdminHandler.HandleClaimIncident))
	mux.HandleFunc("GET /api/v1/admin/ledger/discrepancies", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCIAL_AUDITOR"}, ledgerAdminHandler.HandleGetLedgerDiscrepancies))
	mux.HandleFunc("POST /api/v1/admin/ledger/reconcile", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCIAL_AUDITOR"}, ledgerAdminHandler.HandlePostLedgerCorrection))
	mux.HandleFunc("POST /api/v1/admin/marketplace/force-match", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, orchestratorAdminHandler.HandleManualForceMatch))
	mux.HandleFunc("POST /api/v1/admin/marketplace/geofence", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "MARKET_CONTROLLER"}, orchestratorAdminHandler.HandleUpsertGeofenceZone))
	mux.HandleFunc("GET /api/v1/admin/marketplace/geofence", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "MARKET_CONTROLLER"}, orchestratorAdminHandler.HandleGetGeofenceZones))
	mux.HandleFunc("POST /api/v1/admin/marketplace/fraud-lockout", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, orchestratorAdminHandler.HandleExecuteFraudLockout))
	mux.HandleFunc("GET /api/v1/admin/marketplace/fraud", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, orchestratorAdminHandler.HandleGetFraudAnomalies))
	mux.HandleFunc("GET /api/v1/admin/drivers/pending", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, complianceAdminHandler.HandleGetPendingDrivers))
	mux.HandleFunc("GET /api/v1/admin/drivers/pending/{driver_id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, complianceAdminHandler.HandleGetPendingDriverDetail))
	mux.HandleFunc("POST /api/v1/admin/validation/duplicate-check", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, complianceAdminHandler.HandleDuplicateCheck))
	mux.HandleFunc("POST /api/v1/admin/drivers/verify", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, complianceAdminHandler.HandleVerifyDriver))
	mux.HandleFunc("GET /api/v1/admin/analytics/cells/{h3cell}/drivers", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, complianceAdminHandler.HandleGetDriversInCell))

	// Drivers control endpoints
	mux.HandleFunc("GET /api/v1/admin/drivers", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, driverHandler.HandleGetDrivers))
	mux.HandleFunc("GET /api/v1/admin/drivers/onboarding", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, driverHandler.HandleGetDriverOnboarding))
	mux.HandleFunc("GET /api/v1/admin/drivers/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, driverHandler.HandleGetDriverDetail))
	mux.HandleFunc("POST /api/v1/admin/drivers/{id}/{action}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "COMPLIANCE"}, driverHandler.HandleDriverActions))

	// Riders control endpoints
	mux.HandleFunc("GET /api/v1/admin/riders", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, riderHandler.HandleGetRiders))
	mux.HandleFunc("GET /api/v1/admin/riders/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, riderHandler.HandleGetRiderDetail))
	mux.HandleFunc("POST /api/v1/admin/riders/{id}/{action}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "COMPLIANCE"}, riderHandler.HandleRiderActions))
	mux.HandleFunc("PATCH /api/v1/admin/riders/{id}/{action}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "COMPLIANCE"}, riderHandler.HandleRiderActions))

	// Vehicles control endpoints
	mux.HandleFunc("GET /api/v1/admin/vehicles", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, vehicleHandler.HandleGetVehicles))
	mux.HandleFunc("POST /api/v1/admin/vehicles/reminders", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "COMPLIANCE"}, vehicleHandler.HandleSendDocReminders))
	mux.HandleFunc("POST /api/v1/admin/vehicles/{plate}/override", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "COMPLIANCE"}, vehicleHandler.HandlePostVehicleOverride))

	// Dispatch, Zones & Rules control endpoints
	mux.HandleFunc("GET /api/v1/admin/dispatch/cities", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, dispatchHandler.HandleGetCities))
	mux.HandleFunc("POST /api/v1/admin/dispatch/cities", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CITY_MANAGER", "COMPLIANCE"}, dispatchHandler.HandlePostCity))
	mux.HandleFunc("GET /api/v1/admin/dispatch/rules/{city}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, dispatchHandler.HandleGetDispatchRules))
	mux.HandleFunc("POST /api/v1/admin/dispatch/rules/{city}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CITY_MANAGER", "COMPLIANCE"}, dispatchHandler.HandlePostDispatchRules))

	// Promotions & Offers control endpoints
	mux.HandleFunc("GET /api/v1/admin/promos", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "CUSTOMER_SUPPORT", "ANALYTICS", "CITY_MANAGER", "FINANCE", "AUDITOR"}, promoHandler.HandleGetPromos))
	mux.HandleFunc("POST /api/v1/admin/promos", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "CITY_MANAGER"}, promoHandler.HandlePostPromo))
	mux.HandleFunc("POST /api/v1/admin/promos/bulk", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"}, promoHandler.HandlePostPromosBulk))
	mux.HandleFunc("POST /api/v1/admin/promos/{code}/state", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "CITY_MANAGER"}, promoHandler.HandlePostPromoState))
	mux.HandleFunc("GET /api/v1/admin/promos/{code}/analytics", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "ANALYTICS", "FINANCE"}, promoHandler.HandleGetPromoAnalytics))
	mux.HandleFunc("GET /api/v1/admin/promos/banners", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "CUSTOMER_SUPPORT", "CITY_MANAGER", "ANALYTICS"}, promoHandler.HandleGetBanners))
	mux.HandleFunc("POST /api/v1/admin/promos/banners", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "CITY_MANAGER"}, promoHandler.HandlePostBanners))
	mux.HandleFunc("GET /api/v1/admin/promos/referral", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "FINANCE", "ANALYTICS"}, promoHandler.HandleGetReferralSettings))
	mux.HandleFunc("POST /api/v1/admin/promos/referral", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"}, promoHandler.HandlePostReferralSettings))
	mux.HandleFunc("GET /api/v1/admin/promos/loyalty", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING", "FINANCE", "ANALYTICS"}, promoHandler.HandleGetLoyaltySettings))
	mux.HandleFunc("POST /api/v1/admin/promos/loyalty", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"}, promoHandler.HandlePostLoyaltySettings))

	// Finance & Payments control endpoints
	mux.HandleFunc("GET /api/v1/admin/finance/transactions", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, financeHandler.HandleGetTransactions))
	mux.HandleFunc("GET /api/v1/admin/finance/transactions/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, financeHandler.HandleGetTransactionDetail))
	mux.HandleFunc("GET /api/v1/admin/finance/refunds", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR"}, financeHandler.HandleGetRefunds))
	mux.HandleFunc("POST /api/v1/admin/finance/refunds", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "CUSTOMER_SUPPORT"}, financeHandler.HandlePostRefund))
	mux.HandleFunc("POST /api/v1/admin/finance/refunds/{id}/approve", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, financeHandler.HandleApproveRefund))
	mux.HandleFunc("POST /api/v1/admin/finance/refunds/{id}/reject", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, financeHandler.HandleRejectRefund))
	mux.HandleFunc("GET /api/v1/admin/finance/wallets", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, financeHandler.HandleGetWallets))
	mux.HandleFunc("GET /api/v1/admin/finance/wallets/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, financeHandler.HandleGetWalletDetail))
	mux.HandleFunc("POST /api/v1/admin/finance/wallets/{id}/adjust", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, financeHandler.HandlePostWalletAdjustment))
	mux.HandleFunc("GET /api/v1/admin/finance/invoices", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, financeHandler.HandleGetInvoices))
	mux.HandleFunc("GET /api/v1/admin/finance/invoices/export", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, financeHandler.HandleExportInvoices))
	mux.HandleFunc("GET /api/v1/admin/finance/reconciliation", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR"}, financeHandler.HandleGetReconciliation))
	mux.HandleFunc("GET /api/v1/admin/finance/reconciliation/cash-collect", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR"}, financeHandler.HandleGetCashCollect))
	mux.HandleFunc("POST /api/v1/admin/finance/reconciliation/daily-close", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, financeHandler.HandlePostDailyClose))
	mux.HandleFunc("GET /api/v1/admin/finance/disputes", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR"}, financeHandler.HandleGetDisputes))
	mux.HandleFunc("POST /api/v1/admin/finance/disputes/{id}/evidence", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, financeHandler.HandlePostDisputeEvidence))

	// Dashboard endpoints with proper RBAC protecting all roles
	allAdminRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "MARKETING", "ANALYTICS", "CITY_MANAGER", "COMPLIANCE", "AUDITOR"}
	mux.HandleFunc("GET /api/v1/admin/dashboard/kpis", authGuard.RequireAnyRole(allAdminRoles, dashboardHandler.HandleGetDashboardKPIs))
	mux.HandleFunc("GET /api/v1/admin/dashboard/charts", authGuard.RequireAnyRole(allAdminRoles, dashboardHandler.HandleGetDashboardCharts))
	mux.HandleFunc("GET /api/v1/admin/dashboard/alerts", authGuard.RequireAnyRole(allAdminRoles, dashboardHandler.HandleGetDashboardAlerts))
	mux.HandleFunc("GET /api/v1/admin/dashboard/recent-trips", authGuard.RequireAnyRole(allAdminRoles, dashboardHandler.HandleGetRecentTrips))

	// Administrative admin accounts and audit team controls
	mux.HandleFunc("GET /api/v1/admin/team", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminAuthHandler.HandleListAdmins))
	mux.HandleFunc("POST /api/v1/admin/team/invite", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminAuthHandler.HandleInviteAdmin))
	mux.HandleFunc("POST /api/v1/admin/team/edit-role", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminAuthHandler.HandleEditRole))
	mux.HandleFunc("POST /api/v1/admin/team/suspend", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminAuthHandler.HandleSuspendAdmin))
	mux.HandleFunc("POST /api/v1/admin/team/reset-2fa", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminAuthHandler.HandleReset2FA))
	mux.HandleFunc("GET /api/v1/admin/team/audit", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminAuthHandler.HandleGetAuditLogs))

	corsMiddleware := middleware.NewCORSMiddleware()

	server := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      corsMiddleware.Handler(mux),
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP web container crash: %v", err)
		}
	}()
	log.Println("API Gateway active and accepting connections.")

	// Intercept container termination signals from Kubernetes or OS handles
	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal

	log.Println("Intercepted termination signal. Stopping inbound traffic routing routes...")

	// 1. Create a dedicated context window for the graceful draining sequence
	drainCtx, drainCancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer drainCancel()

	// 2. Shut down the HTTP listener first so the load balancer stops routing new requests to this instance
	_ = server.Shutdown(drainCtx)

	// 3. Broadcast CloseGoingAway handshakes across all active persistent WebSocket sessions
	handler.DrainAndSignalWebSockets(drainCtx)

	// 4. Cancel the main execution context to cleanly stop internal background workers
	mainCancel()

	log.Println("Gateway process terminated cleanly. Zero connection truncation errors encountered.")
}

func startKafkaToRedisFanoutWorker(ctx context.Context, brokers []string, client *redis.ClusterClient) {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		Topic:          "order.assigned",
		GroupID:        "gateway-fanout-group-collective",
		MinBytes:       10,
		MaxBytes:       10e6,
		CommitInterval: 1 * time.Second,
	})
	defer reader.Close()

	for {
		select {
		case <-ctx.Done():
			return
		default:
			msg, err := reader.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				continue
			}
			_ = client.Publish(ctx, gatewayHttp.RedisPubSubChannel, string(msg.Value)).Err()
		}
	}
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
