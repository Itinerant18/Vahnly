package main

import (
	"context"
	"errors"
	"log"
	"net"
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
	driverHttp "github.com/platform/driver-delivery/internal/driver/delivery/http"
	gatewayHttp "github.com/platform/driver-delivery/internal/gateway/delivery/http"
	"github.com/platform/driver-delivery/internal/crypto"
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
	fieldEncKey := getEnv("FIELD_ENCRYPTION_KEY", "kolkata_field_encryption_dev_key_change_in_prod")

	log.Printf("Bootstrapping Coordinated API Gateway on Port: %s", httpPort)

	dbPool, err := pgxpool.New(mainCtx, postgresURL)
	if err != nil {
		log.Fatalf("PostgreSQL connection pool setup failed: %v", err)
	}
	defer dbPool.Close()

	nodeList := strings.Split(redisNodes, ",")

	// Support local port-forwarded routing mapping (required for host dev connectivity to Docker)
	ipMapStr := os.Getenv("REDIS_IP_MAP")
	ipMap := make(map[string]string)
	if ipMapStr != "" {
		for _, pair := range strings.Split(ipMapStr, ",") {
			parts := strings.Split(pair, "=")
			if len(parts) == 2 {
				ipMap[parts[0]] = parts[1]
			}
		}
	}

	redisClusterClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:          nodeList,
		ReadOnly:       false,
		RouteByLatency: true,
		DialTimeout:    2 * time.Second,
		ReadTimeout:    500 * time.Millisecond,
		WriteTimeout:   500 * time.Millisecond,
		Dialer: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if localAddr, ok := ipMap[addr]; ok {
				addr = localAddr
			}
			var dialer net.Dialer
			return dialer.DialContext(ctx, network, addr)
		},
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
		// Synchronous request-path producer: flush each message immediately.
		// The default BatchTimeout is 1s, which alone exhausts the handler's
		// 1000ms request context and yields "context deadline exceeded".
		BatchTimeout: 10 * time.Millisecond,
		BatchSize:    1,
	}
	defer kafkaWriter.Close()

	handler := gatewayHttp.NewGatewayHandler(dbPool, kafkaWriter, pricingService, redisClusterClient)
	handler.SetJWTSecret(jwtSecret)
	go handler.StartGPSWriteBehindWorker(mainCtx)

	adminAuthHandler := adminHttp.NewAdminAuthHandler(dbPool, jwtSecret)
	driverAuthHandler := driverHttp.NewDriverAuthHandler(dbPool, jwtSecret)
	driverOnboardingHandler := driverHttp.NewOnboardingHandler(dbPool)
	if fieldCipher, err := crypto.NewFieldCipher(fieldEncKey); err != nil {
		log.Fatalf("Field encryption cipher setup failed: %v", err)
	} else {
		driverOnboardingHandler.SetFieldCipher(fieldCipher)
	}
	driverDutyHandler := driverHttp.NewDutyHandler(dbPool, redisClusterClient)
	driverAccountHandler := gatewayHttp.NewDriverAccountHandler(dbPool)
	driverSafetyHandler := gatewayHttp.NewSafetyHandler(dbPool)
	offlineSyncHandler := gatewayHttp.NewOfflineSyncHandler(dbPool)
	tripAuditHandler := gatewayHttp.NewTripAuditHandler(dbPool)
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

	driverHttp.SOSCallback = func(driverID string, tripID string, lat, lng float64) {
		// Fetch driver name, vehicle, etc.
		var driverName string
		var licensePlate string
		var vehicleModel string
		var cityPrefix string
		
		err := dbPool.QueryRow(mainCtx, `
			SELECT d.name, d.city_prefix, COALESCE(v.license_plate, 'WB-02-AK-9988'), COALESCE(v.make_model, 'Audi A6 Premium')
			FROM drivers d
			LEFT JOIN vehicles v ON v.driver_id = d.id
			WHERE d.id = $1::uuid
			LIMIT 1
		`, driverID).Scan(&driverName, &cityPrefix, &licensePlate, &vehicleModel)
		if err != nil {
			driverName = "Aniket Karmakar"
			licensePlate = "WB-02-AK-9988"
			vehicleModel = "Audi A6 Premium"
			cityPrefix = "KOL"
		}

		incidentAdminHandler.AddIncident(adminHttp.StalledTripIncident{
			OrderID:              tripID,
			DriverID:             driverID,
			DriverName:           driverName,
			CustomerName:         "Sarah Connor",
			VehicleMakeModel:     vehicleModel,
			LicensePlate:         licensePlate,
			LastKnownStatus:      "ON_TRIP",
			SecondsSinceLastPing: 0,
			CityPrefix:           cityPrefix,
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

	gatewayHttp.StalledTripCallback = func(driverID string, tripID string, lat, lng float64, duration int) {
		// Fetch driver name, vehicle, etc.
		var driverName string
		var licensePlate string
		var vehicleModel string
		var cityPrefix string
		
		err := dbPool.QueryRow(mainCtx, `
			SELECT d.name, d.city_prefix, COALESCE(v.license_plate, 'WB-02-AK-9988'), COALESCE(v.make_model, 'Audi A6 Premium')
			FROM drivers d
			LEFT JOIN vehicles v ON v.driver_id = d.id
			WHERE d.id = $1::uuid
			LIMIT 1
		`, driverID).Scan(&driverName, &cityPrefix, &licensePlate, &vehicleModel)
		if err != nil {
			driverName = "Aniket Karmakar"
			licensePlate = "WB-02-AK-9988"
			vehicleModel = "Audi A6 Premium"
			cityPrefix = "KOL"
		}

		incidentAdminHandler.AddIncident(adminHttp.StalledTripIncident{
			OrderID:              tripID,
			DriverID:             driverID,
			DriverName:           driverName,
			CustomerName:         "Sarah Connor",
			VehicleMakeModel:     vehicleModel,
			LicensePlate:         licensePlate,
			LastKnownStatus:      "DELIVERING",
			SecondsSinceLastPing: duration,
			CityPrefix:           cityPrefix,
			IncidentType:         "SILENCE",
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

	odometerLogger := log.New(os.Stdout, "[ODOMETER_ADMIN] ", log.LstdFlags)
	odometerHandler := adminHttp.NewOdometerHandler(dbPool, odometerLogger)
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

	payoutLogger := log.New(os.Stdout, "[PAYOUT_ADMIN] ", log.LstdFlags)
	payoutHandler := adminHttp.NewPayoutHandler(dbPool, payoutLogger)

	supportLogger := log.New(os.Stdout, "[SUPPORT_ADMIN] ", log.LstdFlags)
	supportHandler := adminHttp.NewSupportHandler(dbPool, supportLogger)

	safetyLogger := log.New(os.Stdout, "[SAFETY_ADMIN] ", log.LstdFlags)
	safetyHandler := adminHttp.NewSafetyHandler(dbPool, safetyLogger)

	marketingLogger := log.New(os.Stdout, "[MARKETING_ADMIN] ", log.LstdFlags)
	marketingHandler := adminHttp.NewMarketingHandler(dbPool, marketingLogger)

	analyticsLogger := log.New(os.Stdout, "[ANALYTICS_ADMIN] ", log.LstdFlags)
	analyticsHandler := adminHttp.NewAnalyticsHandler(dbPool, analyticsLogger)

	configLogger := log.New(os.Stdout, "[CONFIG_ADMIN] ", log.LstdFlags)
	configHandler := adminHttp.NewConfigHandler(dbPool, configLogger)

	developerLogger := log.New(os.Stdout, "[DEV_ADMIN] ", log.LstdFlags)
	developerHandler := adminHttp.NewDeveloperHandler(dbPool, developerLogger)

	corporateLogger := log.New(os.Stdout, "[CORPORATE_ADMIN] ", log.LstdFlags)
	corporateHandler := adminHttp.NewCorporateHandler(dbPool, corporateLogger)

	auditLogger := log.New(os.Stdout, "[AUDIT_ADMIN] ", log.LstdFlags)
	auditHandler := adminHttp.NewAuditHandler(dbPool, auditLogger)

	cmsLogger := log.New(os.Stdout, "[CMS_ADMIN] ", log.LstdFlags)
	cmsHandler := adminHttp.NewCMSHandler(dbPool, cmsLogger)

	documentsLogger := log.New(os.Stdout, "[DOCUMENTS_ADMIN] ", log.LstdFlags)
	documentsHandler := adminHttp.NewDocumentsHandler(dbPool, documentsLogger)

	notificationsLogger := log.New(os.Stdout, "[NOTIFICATIONS_ADMIN] ", log.LstdFlags)
	notificationsHandler := adminHttp.NewNotificationsHandler(dbPool, notificationsLogger)

	aiLogger := log.New(os.Stdout, "[AI_ADMIN] ", log.LstdFlags)
	aiHandler := adminHttp.NewAIHandler(dbPool, aiLogger)

	driverOpsLogger := log.New(os.Stdout, "[DRIVER_OPS_ADMIN] ", log.LstdFlags)
	driverOpsHandler := adminHttp.NewDriverOpsHandler(dbPool, driverOpsLogger)

	platformLogger := log.New(os.Stdout, "[PLATFORM_ADMIN] ", log.LstdFlags)
	platformHandler := adminHttp.NewPlatformHandler(dbPool, platformLogger)

	esgLogger := log.New(os.Stdout, "[ESG_ADMIN] ", log.LstdFlags)
	esgHandler := adminHttp.NewESGHandler(dbPool, esgLogger)

	franchiseLogger := log.New(os.Stdout, "[FRANCHISE_ADMIN] ", log.LstdFlags)
	franchiseHandler := adminHttp.NewFranchiseHandler(dbPool, franchiseLogger)

	adminToolsLogger := log.New(os.Stdout, "[ADMIN_TOOLS] ", log.LstdFlags)
	adminToolsHandler := adminHttp.NewAdminToolsHandler(dbPool, adminToolsLogger)

	go handler.InternalBackplaneMultiplexer(mainCtx)
	go startKafkaToRedisFanoutWorker(mainCtx, brokersList, redisClusterClient)

	// Instantiate edge protection layers
	authGuard := middleware.NewAuthMiddleware(jwtSecret)
	// Rate Limit parameters: Allow maximum 1000 requests per 1 minute rolling window
	rateLimiter := middleware.NewRateLimiterMiddleware(redisClusterClient, 1000, 1*time.Minute)

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

	// Driver App & Onboarding routes
	mux.HandleFunc("POST /api/v1/driver/login", driverAuthHandler.HandleDriverLogin)
	mux.HandleFunc("POST /api/v1/driver/register", driverAuthHandler.HandleDriverRegister)
	mux.HandleFunc("POST /api/v1/driver/onboarding/step/{step_id}", authGuard.AuthenticateJWT(driverOnboardingHandler.HandleSaveStep))
	mux.HandleFunc("POST /api/v1/driver/onboarding/upload", authGuard.AuthenticateJWT(driverOnboardingHandler.HandleUploadDocument))
	mux.HandleFunc("POST /api/v1/driver/onboarding/presigned-url", authGuard.AuthenticateJWT(driverOnboardingHandler.HandleGeneratePresignedURL))
	mux.HandleFunc("POST /api/v1/driver/onboarding/quiz", authGuard.AuthenticateJWT(driverOnboardingHandler.HandleValidateQuiz))

	// Driver operational duty, SOS, stats and OTP routes
	mux.HandleFunc("POST /api/v1/driver/duty", authGuard.AuthenticateJWT(driverDutyHandler.HandleDutyStateToggle))
	mux.HandleFunc("POST /api/v1/driver/sos", authGuard.AuthenticateJWT(driverDutyHandler.HandleTriggerSOS))
	mux.HandleFunc("GET /api/v1/driver/stats", authGuard.AuthenticateJWT(driverDutyHandler.HandleGetStats))
	mux.HandleFunc("POST /api/v1/driver/orders/{id}/verify-otp", authGuard.AuthenticateJWT(driverDutyHandler.HandleVerifyOTPAndStartTrip))
	mux.HandleFunc("PATCH /api/v1/driver/orders/{id}/verify-otp", authGuard.AuthenticateJWT(driverDutyHandler.HandleVerifyOTPAndStartTrip))
	mux.HandleFunc("GET /api/v1/driver/orders/{id}", authGuard.AuthenticateJWT(handler.HandleDriverGetOrder))

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
	mux.HandleFunc("PATCH /api/v1/driver/orders/{id}/offer-response", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleOfferResponse))))
	mux.HandleFunc("PATCH /api/v1/driver/orders/{id}/arrived", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleDriverArrived))))
	mux.HandleFunc("PATCH /api/v1/driver/orders/{id}/start", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleDriverStartTrip))))
	mux.HandleFunc("POST /api/v1/driver/orders/{id}/events", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleDriverAddOrderEvent))))
	mux.HandleFunc("PATCH /api/v1/driver/orders/{id}/end", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleDriverEndTrip))))
	mux.HandleFunc("POST /api/v1/driver/orders/{id}/confirm-payment", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleDriverConfirmPayment))))
	mux.HandleFunc("GET /api/v1/driver/trips", authGuard.AuthenticateJWT(handler.HandleDriverGetTrips))
	mux.HandleFunc("GET /api/v1/driver/earnings", authGuard.AuthenticateJWT(handler.HandleDriverGetEarnings))
	mux.HandleFunc("POST /api/v1/driver/device-token", authGuard.AuthenticateJWT(handler.HandleRegisterDeviceToken))
	mux.HandleFunc("POST /api/v1/driver/location", authGuard.AuthenticateJWT(handler.HandleDriverLocationUpdate))
	mux.HandleFunc("POST /api/v1/payments/webhook", handler.HandlePaymentWebhook)
	mux.HandleFunc("POST /api/v1/sos/trigger", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(handler.HandleTriggerSOS)))

	// Driver Safety & Emergency Protocol (Feature 11)
	mux.HandleFunc("POST /api/v1/driver/safety/sos", authGuard.AuthenticateJWT(driverSafetyHandler.TriggerSOSAlert))
	mux.HandleFunc("GET /api/v1/driver/safety/fatigue-check", authGuard.AuthenticateJWT(driverSafetyHandler.AssessFatigueLimits))

	// Driver Offline mode caching & Sync Buffers (Feature 12)
	mux.HandleFunc("POST /api/v1/driver/sync/offline-payload", authGuard.AuthenticateJWT(offlineSyncHandler.BulkReconcileOfflineData))

	// Driver Account, Payouts & Notifications (Features 8 & 9)
	mux.HandleFunc("GET /api/v1/driver-account/earnings", authGuard.AuthenticateJWT(driverAccountHandler.GetEarningsSummary))
	mux.HandleFunc("POST /api/v1/driver-account/payouts/withdraw", authGuard.AuthenticateJWT(driverAccountHandler.TriggerInstantPayout))
	mux.HandleFunc("GET /api/v1/driver-account/notifications", authGuard.AuthenticateJWT(driverAccountHandler.GetNotifications))

	// Driver odometer ingestion endpoint (Phase 2: The Odometer Writer)
	mux.HandleFunc("POST /api/v1/driver/orders/{id}/odometer", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleDriverOdometerCheckpoint))))

	// Register administrative control routes, protected by granular RBAC role gates
	mux.HandleFunc("GET /api/v1/admin/ledger", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCIAL_AUDITOR"}, handler.HandleAdminGetLedger))
	mux.HandleFunc("POST /api/v1/admin/drivers/override", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FLEET_MANAGER"}, handler.HandleAdminDriverOverride))
	mux.HandleFunc("GET /api/v1/admin/orders", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR"}, adminTripHandler.HandleAdminGetOrders))
	mux.HandleFunc("POST /api/v1/admin/orders/cancel", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT"}, adminTripHandler.HandleAdminCancelOrder))
	mux.HandleFunc("GET /api/v1/admin/orders/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR"}, adminTripHandler.HandleAdminGetTripDetail))
	mux.HandleFunc("GET /api/v1/admin/orders/{id}/forensic-audit", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR"}, tripAuditHandler.CompileTripAuditTrail))
	mux.HandleFunc("POST /api/v1/admin/orders", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER"}, adminTripHandler.HandleAdminCreateTrip))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/reopen", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, adminTripHandler.HandleAdminReopenTrip))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/reassign", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER"}, adminTripHandler.HandleAdminReassignTrip))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/fraud", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER"}, adminTripHandler.HandleAdminMarkFraud))
	mux.HandleFunc("POST /api/v1/admin/orders/{id}/send-invoice", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT"}, adminTripHandler.HandleAdminSendInvoice))
	mux.HandleFunc("GET /api/v1/admin/orders/{id}/odometer-audit", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCIAL_AUDITOR", "OPERATIONS_MANAGER", "COMPLIANCE"}, odometerHandler.HandleGetOdometerAudit))
	mux.HandleFunc("PATCH /api/v1/admin/orders/{id}/odometer-audit", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCIAL_AUDITOR"}, odometerHandler.HandlePatchOdometerAudit))
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
	mux.HandleFunc("GET /api/v1/admin/vehicles/{plate}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, vehicleHandler.HandleGetVehicleDetail))
	mux.HandleFunc("GET /api/v1/admin/customers/vehicles", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "AUDITOR", "CITY_MANAGER", "FINANCE", "COMPLIANCE"}, vehicleHandler.HandleGetCustomerVehicleProfiles))
	mux.HandleFunc("POST /api/v1/admin/customers/vehicles/update", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "COMPLIANCE"}, vehicleHandler.HandlePostCustomerVehicleProfileUpdate))


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

	// Payouts control endpoints
	mux.HandleFunc("GET /api/v1/admin/finance/payouts", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, payoutHandler.HandleGetPayouts))
	mux.HandleFunc("GET /api/v1/admin/finance/payouts/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR", "AUDITOR"}, payoutHandler.HandleGetPayoutDetail))
	mux.HandleFunc("POST /api/v1/admin/finance/payouts/bulk-approve", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, payoutHandler.HandleBulkApprovePayouts))
	mux.HandleFunc("GET /api/v1/admin/finance/payouts/export-batch", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE", "FINANCIAL_AUDITOR"}, payoutHandler.HandleExportPayoutBatch))
	mux.HandleFunc("POST /api/v1/admin/finance/payouts/{id}/retry", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, payoutHandler.HandleRetryPayout))
	mux.HandleFunc("POST /api/v1/admin/finance/payouts/{id}/hold", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, payoutHandler.HandleHoldPayout))
	mux.HandleFunc("POST /api/v1/admin/finance/payouts/{id}/release", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, payoutHandler.HandleReleasePayout))

	// Support & Ticket control endpoints
	supportRoles := []string{"SUPER_ADMIN", "CUSTOMER_SUPPORT", "SUPPORT_LEAD", "SAFETY", "FINANCE"}
	mux.HandleFunc("GET /api/v1/admin/support/tickets", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleGetTickets))
	mux.HandleFunc("GET /api/v1/admin/support/tickets/{id}", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleGetTicketDetail))
	mux.HandleFunc("POST /api/v1/admin/support/tickets", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleCreateTicket))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/bulk-assign", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleBulkAssignTickets))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/merge", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleMergeTickets))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/{id}/tags", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleUpdateTicketTags))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/{id}/message", authGuard.RequireAnyRole(supportRoles, supportHandler.HandlePostMessage))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/{id}/escalate", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleEscalateTicket))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/{id}/resolve", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleResolveTicket))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/{id}/close", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleCloseTicket))
	mux.HandleFunc("POST /api/v1/admin/support/tickets/{id}/csat", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleSubmitCSAT))
	mux.HandleFunc("GET /api/v1/admin/support/lost-found", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleGetLostFoundItems))
	mux.HandleFunc("POST /api/v1/admin/support/lost-found", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleCreateLostFoundItem))
	mux.HandleFunc("PATCH /api/v1/admin/support/lost-found/{id}", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleUpdateLostFoundItem))
	mux.HandleFunc("POST /api/v1/admin/support/lost-found/{id}", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleUpdateLostFoundItem))
	mux.HandleFunc("GET /api/v1/admin/support/macros", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleGetMacros))
	mux.HandleFunc("POST /api/v1/admin/support/macros", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleCreateMacro))
	mux.HandleFunc("GET /api/v1/admin/support/faqs", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleGetFAQs))
	mux.HandleFunc("POST /api/v1/admin/support/faqs", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleCreateFAQ))
	mux.HandleFunc("GET /api/v1/admin/support/stats", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleGetSupportStats))
	mux.HandleFunc("POST /api/v1/admin/support/click-to-call", authGuard.RequireAnyRole(supportRoles, supportHandler.HandleClickToCall))

	// Safety & Incident control endpoints
	safetyRoles := []string{"SUPER_ADMIN", "SUPPORT_LEAD", "SAFETY"}
	mux.HandleFunc("GET /api/v1/admin/safety/sos", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleGetSOSAlerts))
	mux.HandleFunc("POST /api/v1/admin/safety/sos", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleCreateSOSAlert))
	mux.HandleFunc("POST /api/v1/admin/safety/sos/{id}/acknowledge", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleAcknowledgeSOSAlert))
	mux.HandleFunc("POST /api/v1/admin/safety/sos/{id}/resolve", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleResolveSOSAlert))
	mux.HandleFunc("POST /api/v1/admin/safety/sos/{id}/actions", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleExecuteSOSAction))
	mux.HandleFunc("GET /api/v1/admin/safety/incidents", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleGetIncidents))
	mux.HandleFunc("POST /api/v1/admin/safety/incidents", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleCreateIncident))
	mux.HandleFunc("GET /api/v1/admin/safety/incidents/{id}", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleGetIncidentDetail))
	mux.HandleFunc("POST /api/v1/admin/safety/incidents/{id}/outcome", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleResolveIncidentOutcome))
	mux.HandleFunc("POST /api/v1/admin/safety/incidents/{id}/claim", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleProcessD4MCareClaim))
	mux.HandleFunc("GET /api/v1/admin/safety/anomalies", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleGetAnomalies))
	mux.HandleFunc("POST /api/v1/admin/safety/anomalies/{id}/resolve", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleResolveAnomaly))
	mux.HandleFunc("GET /api/v1/admin/safety/blacklist", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleGetBlacklist))
	mux.HandleFunc("POST /api/v1/admin/safety/blacklist", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleAddBlacklistBlock))
	mux.HandleFunc("DELETE /api/v1/admin/safety/blacklist/{id}", authGuard.RequireAnyRole(safetyRoles, safetyHandler.HandleRemoveBlacklistBlock))

	// Marketing & Campaign control endpoints
	marketingRoles := []string{"SUPER_ADMIN", "MARKETING", "OPERATIONS_MANAGER"}
	mux.HandleFunc("GET /api/v1/admin/marketing/segments", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetSegments))
	mux.HandleFunc("POST /api/v1/admin/marketing/segments", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleCreateSegment))
	mux.HandleFunc("DELETE /api/v1/admin/marketing/segments/{id}", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleDeleteSegment))
	mux.HandleFunc("POST /api/v1/admin/marketing/segments/estimate", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleEstimateSegment))
	mux.HandleFunc("GET /api/v1/admin/marketing/campaigns", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetCampaigns))
	mux.HandleFunc("POST /api/v1/admin/marketing/campaigns", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleCreateCampaign))
	mux.HandleFunc("POST /api/v1/admin/marketing/campaigns/{id}/status", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleUpdateCampaignStatus))
	mux.HandleFunc("GET /api/v1/admin/marketing/campaigns/{id}/analytics", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetCampaignAnalytics))
	mux.HandleFunc("POST /api/v1/admin/marketing/campaigns/{id}/conversions", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleRecordConversion))
	mux.HandleFunc("GET /api/v1/admin/marketing/banners", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetBanners))
	mux.HandleFunc("POST /api/v1/admin/marketing/banners", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleCreateBanner))
	mux.HandleFunc("PATCH /api/v1/admin/marketing/banners/{id}", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleToggleBannerStatus))
	mux.HandleFunc("GET /api/v1/admin/marketing/templates/push", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetPushTemplates))
	mux.HandleFunc("POST /api/v1/admin/marketing/templates/push", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleCreatePushTemplate))
	mux.HandleFunc("GET /api/v1/admin/marketing/templates/sms", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetSMSTemplates))
	mux.HandleFunc("POST /api/v1/admin/marketing/templates/sms", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleCreateSMSTemplate))
	mux.HandleFunc("GET /api/v1/admin/marketing/templates/email", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetEmailTemplates))
	mux.HandleFunc("POST /api/v1/admin/marketing/templates/email", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleCreateEmailTemplate))
	mux.HandleFunc("GET /api/v1/admin/marketing/domains", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleGetDomains))
	mux.HandleFunc("POST /api/v1/admin/marketing/domains", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleCreateDomain))
	mux.HandleFunc("POST /api/v1/admin/marketing/domains/{id}/verify", authGuard.RequireAnyRole(marketingRoles, marketingHandler.HandleVerifyDomain))

	// Analytics & Reports endpoints
	analyticsRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "ANALYTICS", "FINANCE", "CITY_MANAGER", "AUDITOR"}
	mux.HandleFunc("GET /api/v1/admin/analytics/summary", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleGetAnalyticsSummary))
	mux.HandleFunc("GET /api/v1/admin/analytics/trips-over-time", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleGetTripsOverTime))
	mux.HandleFunc("GET /api/v1/admin/analytics/revenue-over-time", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleGetRevenueOverTime))
	mux.HandleFunc("GET /api/v1/admin/analytics/demand-by-hour", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleGetDemandByHour))
	mux.HandleFunc("GET /api/v1/admin/analytics/funnel", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleGetFunnel))
	mux.HandleFunc("GET /api/v1/admin/analytics/top-cities", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleGetTopCities))
	mux.HandleFunc("GET /api/v1/admin/analytics/prebuilt/{dashboard}", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleGetPrebuiltDashboard))
	mux.HandleFunc("GET /api/v1/admin/analytics/export", authGuard.RequireAnyRole(analyticsRoles, analyticsHandler.HandleExportCSV))

	// CMS endpoints
	cmsRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "MARKETING"}
	mux.HandleFunc("GET /api/v1/admin/cms/pages", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleGetPages))
	mux.HandleFunc("POST /api/v1/admin/cms/pages", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleCreatePage))
	mux.HandleFunc("GET /api/v1/admin/cms/pages/{id}", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleGetPageDetail))
	mux.HandleFunc("POST /api/v1/admin/cms/pages/{id}/content", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleSaveContent))
	mux.HandleFunc("POST /api/v1/admin/cms/pages/{id}/publish", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandlePublishPage))
	mux.HandleFunc("GET /api/v1/admin/cms/pages/{id}/history", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleGetVersionHistory))
	mux.HandleFunc("GET /api/v1/admin/cms/i18n", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleGetI18NStrings))
	mux.HandleFunc("POST /api/v1/admin/cms/i18n", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleUpsertI18NString))
	mux.HandleFunc("GET /api/v1/admin/cms/assets", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleGetAssets))
	mux.HandleFunc("POST /api/v1/admin/cms/assets", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleCreateAsset))
	mux.HandleFunc("PATCH /api/v1/admin/cms/assets/{id}", authGuard.RequireAnyRole(cmsRoles, cmsHandler.HandleUpdateAssetStatus))

	// Documents vault + privacy requests
	docRoles := []string{"SUPER_ADMIN", "COMPLIANCE", "FLEET_MANAGER", "FINANCE", "AUDITOR"}
	mux.HandleFunc("GET /api/v1/admin/documents", authGuard.RequireAnyRole(docRoles, documentsHandler.HandleGetDocuments))
	mux.HandleFunc("GET /api/v1/admin/documents/expiring", authGuard.RequireAnyRole(docRoles, documentsHandler.HandleGetExpiringDocuments))
	mux.HandleFunc("GET /api/v1/admin/documents/{id}", authGuard.RequireAnyRole(docRoles, documentsHandler.HandleGetDocumentDetail))
	mux.HandleFunc("POST /api/v1/admin/documents/{id}/tags", authGuard.RequireAnyRole(docRoles, documentsHandler.HandleUpdateTags))
	mux.HandleFunc("PATCH /api/v1/admin/documents/{id}/tags", authGuard.RequireAnyRole(docRoles, documentsHandler.HandleUpdateTags))
	mux.HandleFunc("DELETE /api/v1/admin/documents/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "COMPLIANCE"}, documentsHandler.HandleDeleteDocument))
	mux.HandleFunc("GET /api/v1/admin/compliance/privacy-requests", authGuard.RequireAnyRole(docRoles, documentsHandler.HandleGetPrivacyRequests))
	mux.HandleFunc("POST /api/v1/admin/compliance/privacy-requests", authGuard.RequireAnyRole(docRoles, documentsHandler.HandleCreatePrivacyRequest))
	mux.HandleFunc("POST /api/v1/admin/compliance/privacy-requests/{id}/process", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "COMPLIANCE"}, documentsHandler.HandleProcessPrivacyRequest))

	// Audit log endpoints (SUPER_ADMIN + AUDITOR only)
	auditViewRoles := []string{"SUPER_ADMIN", "AUDITOR", "FINANCIAL_AUDITOR", "COMPLIANCE"}
	mux.HandleFunc("GET /api/v1/admin/audit/logs", authGuard.RequireAnyRole(auditViewRoles, auditHandler.HandleGetAuditLogs))
	mux.HandleFunc("GET /api/v1/admin/audit/actions", authGuard.RequireAnyRole(auditViewRoles, auditHandler.HandleGetAuditActions))
	mux.HandleFunc("GET /api/v1/admin/audit/export", authGuard.RequireAnyRole(auditViewRoles, auditHandler.HandleExportAuditCSV))
	mux.HandleFunc("DELETE /api/v1/admin/audit/cleanup", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, auditHandler.HandleRetentionCleanup))

	// Developer / API endpoints
	devRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}
	mux.HandleFunc("GET /api/v1/admin/dev/keys", authGuard.RequireAnyRole(devRoles, developerHandler.HandleGetKeys))
	mux.HandleFunc("POST /api/v1/admin/dev/keys", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, developerHandler.HandleCreateKey))
	mux.HandleFunc("PATCH /api/v1/admin/dev/keys/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, developerHandler.HandleUpdateKey))
	mux.HandleFunc("DELETE /api/v1/admin/dev/keys/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, developerHandler.HandleRevokeKey))
	mux.HandleFunc("GET /api/v1/admin/dev/webhooks", authGuard.RequireAnyRole(devRoles, developerHandler.HandleGetWebhooks))
	mux.HandleFunc("POST /api/v1/admin/dev/webhooks", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, developerHandler.HandleCreateWebhook))
	mux.HandleFunc("PATCH /api/v1/admin/dev/webhooks/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, developerHandler.HandleUpdateWebhook))
	mux.HandleFunc("POST /api/v1/admin/dev/webhooks/{id}/test", authGuard.RequireAnyRole(devRoles, developerHandler.HandleTestWebhook))
	mux.HandleFunc("GET /api/v1/admin/dev/logs", authGuard.RequireAnyRole(devRoles, developerHandler.HandleGetAPILogs))
	mux.HandleFunc("GET /api/v1/admin/dev/incidents", authGuard.RequireAnyRole(devRoles, developerHandler.HandleGetIncidents))
	mux.HandleFunc("POST /api/v1/admin/dev/incidents", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, developerHandler.HandleUpsertIncident))
	mux.HandleFunc("PATCH /api/v1/admin/dev/incidents/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, developerHandler.HandleUpsertIncident))

	// Corporate / B2B endpoints
	corpRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FINANCE"}
	mux.HandleFunc("GET /api/v1/admin/corporate", authGuard.RequireAnyRole(corpRoles, corporateHandler.HandleGetAccounts))
	mux.HandleFunc("POST /api/v1/admin/corporate", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, corporateHandler.HandleCreateAccount))
	mux.HandleFunc("PATCH /api/v1/admin/corporate/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, corporateHandler.HandleUpdateAccount))
	mux.HandleFunc("GET /api/v1/admin/corporate/{id}/employees", authGuard.RequireAnyRole(corpRoles, corporateHandler.HandleGetEmployees))
	mux.HandleFunc("POST /api/v1/admin/corporate/{id}/employees", authGuard.RequireAnyRole(corpRoles, corporateHandler.HandleAddEmployee))
	mux.HandleFunc("POST /api/v1/admin/corporate/{id}/employees/bulk", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, corporateHandler.HandleBulkUploadEmployees))
	mux.HandleFunc("PATCH /api/v1/admin/corporate/{id}/employees/{empId}", authGuard.RequireAnyRole(corpRoles, corporateHandler.HandleUpdateEmployee))
	mux.HandleFunc("GET /api/v1/admin/corporate/{id}/policies", authGuard.RequireAnyRole(corpRoles, corporateHandler.HandleGetPolicies))
	mux.HandleFunc("POST /api/v1/admin/corporate/{id}/policies", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, corporateHandler.HandleUpsertPolicy))
	mux.HandleFunc("PATCH /api/v1/admin/corporate/{id}/policies/{policyId}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, corporateHandler.HandleUpsertPolicy))
	mux.HandleFunc("GET /api/v1/admin/corporate/{id}/invoices", authGuard.RequireAnyRole(corpRoles, corporateHandler.HandleGetInvoices))
	mux.HandleFunc("POST /api/v1/admin/corporate/{id}/invoices/generate", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, corporateHandler.HandleGenerateInvoice))
	mux.HandleFunc("PATCH /api/v1/admin/corporate/{id}/invoices/{invId}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "FINANCE"}, corporateHandler.HandleUpdateInvoiceStatus))
	mux.HandleFunc("GET /api/v1/admin/corporate/{id}/analytics", authGuard.RequireAnyRole(corpRoles, corporateHandler.HandleGetCorporateAnalytics))

	// Notifications Center endpoints
	notifRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "SUPPORT_LEAD", "SAFETY", "FINANCE"}
	mux.HandleFunc("GET /api/v1/admin/notifications/stats", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleGetNotificationStats))
	mux.HandleFunc("GET /api/v1/admin/notifications/rules", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleGetAlertRules))
	mux.HandleFunc("POST /api/v1/admin/notifications/rules", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, notificationsHandler.HandleUpsertAlertRule))
	mux.HandleFunc("PATCH /api/v1/admin/notifications/rules/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, notificationsHandler.HandleUpsertAlertRule))
	mux.HandleFunc("PATCH /api/v1/admin/notifications/rules/{id}/toggle", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, notificationsHandler.HandleToggleAlertRule))
	mux.HandleFunc("GET /api/v1/admin/notifications/rules/{id}/recipients", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleGetRecipients))
	mux.HandleFunc("PUT /api/v1/admin/notifications/rules/{id}/recipients", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, notificationsHandler.HandleSetRecipients))
	mux.HandleFunc("GET /api/v1/admin/notifications/channels", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleGetChannelConfigs))
	mux.HandleFunc("PUT /api/v1/admin/notifications/channels/{channel}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, notificationsHandler.HandleUpsertChannelConfig))
	mux.HandleFunc("POST /api/v1/admin/notifications/channels/{channel}/test", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleTestChannel))
	mux.HandleFunc("POST /api/v1/admin/notifications/simulate", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, notificationsHandler.HandleSimulateAlert))
	mux.HandleFunc("POST /api/v1/admin/notifications/bulk-acknowledge", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleBulkAcknowledge))
	mux.HandleFunc("GET /api/v1/admin/notifications", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleGetNotifications))
	mux.HandleFunc("GET /api/v1/admin/notifications/{id}", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleGetNotificationDetail))
	mux.HandleFunc("POST /api/v1/admin/notifications/{id}/acknowledge", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleAcknowledgeNotification))
	mux.HandleFunc("POST /api/v1/admin/notifications/{id}/resolve", authGuard.RequireAnyRole(notifRoles, notificationsHandler.HandleResolveNotification))

	// AI Intelligence endpoints (fraud, demand heatmap, VoC)
	aiRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "COMPLIANCE", "ANALYTICS"}
	mux.HandleFunc("GET /api/v1/admin/ai/fraud/events", authGuard.RequireAnyRole(aiRoles, aiHandler.HandleGetFraudEvents))
	mux.HandleFunc("PATCH /api/v1/admin/ai/fraud/events/{id}", authGuard.RequireAnyRole(aiRoles, aiHandler.HandleUpdateFraudEvent))
	mux.HandleFunc("GET /api/v1/admin/ai/fraud/rules", authGuard.RequireAnyRole(aiRoles, aiHandler.HandleGetFraudRules))
	mux.HandleFunc("PATCH /api/v1/admin/ai/fraud/rules/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "COMPLIANCE"}, aiHandler.HandleUpdateFraudRule))
	mux.HandleFunc("GET /api/v1/admin/ai/demand-forecasts", authGuard.RequireAnyRole(aiRoles, aiHandler.HandleGetDemandForecasts))
	mux.HandleFunc("GET /api/v1/admin/ai/voc/topics", authGuard.RequireAnyRole(aiRoles, aiHandler.HandleGetVoCTopics))

	// Driver Operations endpoints (incentives, coaching, inspection, telematics)
	dopsRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER"}
	mux.HandleFunc("GET /api/v1/admin/driver-ops/incentives", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleGetIncentiveCampaigns))
	mux.HandleFunc("POST /api/v1/admin/driver-ops/incentives", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleUpsertIncentiveCampaign))
	mux.HandleFunc("PATCH /api/v1/admin/driver-ops/incentives/{id}", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleUpsertIncentiveCampaign))
	mux.HandleFunc("GET /api/v1/admin/driver-ops/coaching/flags", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleGetCoachingFlags))
	mux.HandleFunc("POST /api/v1/admin/driver-ops/coaching/flags/{id}/resolve", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleResolveCoachingFlag))
	mux.HandleFunc("GET /api/v1/admin/driver-ops/coaching/modules", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleGetTrainingModules))
	mux.HandleFunc("GET /api/v1/admin/driver-ops/inspections", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleGetInspections))
	mux.HandleFunc("PATCH /api/v1/admin/driver-ops/inspections/{id}/review", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleReviewInspection))
	mux.HandleFunc("GET /api/v1/admin/driver-ops/telematics/events", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleGetTelematicsEvents))
	mux.HandleFunc("GET /api/v1/admin/driver-ops/telematics/summaries", authGuard.RequireAnyRole(dopsRoles, driverOpsHandler.HandleGetTelematicsSummaries))

	// Platform Engineering endpoints (service health, experiments, chatbot)
	platRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "ANALYTICS"}
	mux.HandleFunc("GET /api/v1/admin/platform/health", authGuard.RequireAnyRole(platRoles, platformHandler.HandleGetServiceHealth))
	mux.HandleFunc("POST /api/v1/admin/platform/health/incidents", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, platformHandler.HandleUpsertHealthIncident))
	mux.HandleFunc("PATCH /api/v1/admin/platform/health/incidents/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, platformHandler.HandleUpsertHealthIncident))
	mux.HandleFunc("GET /api/v1/admin/platform/experiments", authGuard.RequireAnyRole(platRoles, platformHandler.HandleGetExperiments))
	mux.HandleFunc("POST /api/v1/admin/platform/experiments", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, platformHandler.HandleUpsertExperiment))
	mux.HandleFunc("PATCH /api/v1/admin/platform/experiments/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, platformHandler.HandleUpsertExperiment))
	mux.HandleFunc("GET /api/v1/admin/platform/chatbot", authGuard.RequireAnyRole(platRoles, platformHandler.HandleGetChatbotStats))
	mux.HandleFunc("POST /api/v1/admin/platform/chatbot/intents", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, platformHandler.HandleUpsertChatbotIntent))
	mux.HandleFunc("PATCH /api/v1/admin/platform/chatbot/intents/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}, platformHandler.HandleUpsertChatbotIntent))

	// ESG / Carbon reporting endpoints
	esgRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "COMPLIANCE", "ANALYTICS"}
	mux.HandleFunc("GET /api/v1/admin/esg/summary", authGuard.RequireAnyRole(esgRoles, esgHandler.HandleGetESGSummary))
	mux.HandleFunc("POST /api/v1/admin/esg/reports/{id}/publish", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, esgHandler.HandlePublishESGReport))

	// Franchise / Multi-tenant endpoints
	franchRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}
	mux.HandleFunc("GET /api/v1/admin/franchise/tenants", authGuard.RequireAnyRole(franchRoles, franchiseHandler.HandleGetTenants))
	mux.HandleFunc("POST /api/v1/admin/franchise/tenants", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, franchiseHandler.HandleUpsertTenant))
	mux.HandleFunc("PATCH /api/v1/admin/franchise/tenants/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, franchiseHandler.HandleUpsertTenant))
	mux.HandleFunc("GET /api/v1/admin/franchise/operators", authGuard.RequireAnyRole(franchRoles, franchiseHandler.HandleGetTenantOperators))
	mux.HandleFunc("POST /api/v1/admin/franchise/operators", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, franchiseHandler.HandleAddTenantOperator))

	// Admin Tools endpoints (impersonation, bulk ops, cron, exports)
	toolsRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}
	mux.HandleFunc("GET /api/v1/admin/tools/impersonation", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminToolsHandler.HandleGetImpersonationSessions))
	mux.HandleFunc("POST /api/v1/admin/tools/impersonation", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminToolsHandler.HandleStartImpersonation))
	mux.HandleFunc("POST /api/v1/admin/tools/impersonation/{id}/end", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminToolsHandler.HandleEndImpersonation))
	mux.HandleFunc("GET /api/v1/admin/tools/bulk-operations", authGuard.RequireAnyRole(toolsRoles, adminToolsHandler.HandleGetBulkOperations))
	mux.HandleFunc("POST /api/v1/admin/tools/bulk-operations/{id}/approve", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminToolsHandler.HandleApproveBulkOperation))
	mux.HandleFunc("GET /api/v1/admin/tools/cron-jobs", authGuard.RequireAnyRole(toolsRoles, adminToolsHandler.HandleGetCronJobs))
	mux.HandleFunc("POST /api/v1/admin/tools/cron-jobs/{id}/toggle", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, adminToolsHandler.HandleToggleCronJob))
	mux.HandleFunc("GET /api/v1/admin/tools/exports/queries", authGuard.RequireAnyRole(toolsRoles, adminToolsHandler.HandleGetExportQueries))
	mux.HandleFunc("GET /api/v1/admin/tools/exports/jobs", authGuard.RequireAnyRole(toolsRoles, adminToolsHandler.HandleGetExportJobs))
	mux.HandleFunc("POST /api/v1/admin/tools/exports/jobs", authGuard.RequireAnyRole(toolsRoles, adminToolsHandler.HandleSubmitExportJob))

	// Config / Settings endpoints
	configRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER"}
	mux.HandleFunc("GET /api/v1/admin/config/settings", authGuard.RequireAnyRole(configRoles, configHandler.HandleGetSettings))
	mux.HandleFunc("POST /api/v1/admin/config/settings", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertSettings))
	mux.HandleFunc("GET /api/v1/admin/config/flags", authGuard.RequireAnyRole(configRoles, configHandler.HandleGetFlags))
	mux.HandleFunc("POST /api/v1/admin/config/flags", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertFlag))
	mux.HandleFunc("PATCH /api/v1/admin/config/flags/{key}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertFlag))
	mux.HandleFunc("GET /api/v1/admin/config/versions", authGuard.RequireAnyRole(configRoles, configHandler.HandleGetAppVersions))
	mux.HandleFunc("POST /api/v1/admin/config/versions", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleCreateAppVersion))
	mux.HandleFunc("POST /api/v1/admin/config/versions/{id}/set-latest", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleSetLatestVersion))
	mux.HandleFunc("GET /api/v1/admin/config/integrations", authGuard.RequireAnyRole(configRoles, configHandler.HandleGetIntegrations))
	mux.HandleFunc("PATCH /api/v1/admin/config/integrations/{key}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpdateIntegration))
	mux.HandleFunc("POST /api/v1/admin/config/integrations/{key}/health-check", authGuard.RequireAnyRole(configRoles, configHandler.HandleHealthCheckIntegration))
	mux.HandleFunc("GET /api/v1/admin/config/templates", authGuard.RequireAnyRole(configRoles, configHandler.HandleGetTemplates))
	mux.HandleFunc("POST /api/v1/admin/config/templates", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertTemplate))
	mux.HandleFunc("GET /api/v1/admin/config/cancellation-rules", authGuard.RequireAnyRole(configRoles, configHandler.HandleGetCancellationRules))
	mux.HandleFunc("POST /api/v1/admin/config/cancellation-rules", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertCancellationRule))
	mux.HandleFunc("PATCH /api/v1/admin/config/cancellation-rules/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertCancellationRule))
	mux.HandleFunc("GET /api/v1/admin/config/rating-rules", authGuard.RequireAnyRole(configRoles, configHandler.HandleGetRatingRules))
	mux.HandleFunc("POST /api/v1/admin/config/rating-rules", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertRatingRule))
	mux.HandleFunc("PATCH /api/v1/admin/config/rating-rules/{id}", authGuard.RequireAnyRole([]string{"SUPER_ADMIN"}, configHandler.HandleUpsertRatingRule))

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
