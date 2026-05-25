package grpc

import (
	"io"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/platform/driver-delivery/internal/telemetry/domain"
	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1" // Compiled proto path [cite: 107]
)

type LocationIngestionHandler struct {
	pb.UnimplementedLocationIngestionServiceServer
	useCase domain.TelemetryUseCase
}

func NewLocationIngestionHandler(uc domain.TelemetryUseCase) *LocationIngestionHandler {
	return &LocationIngestionHandler{useCase: uc}
}

func (h *LocationIngestionHandler) ClientStreamPositions(stream pb.LocationIngestionService_ClientStreamPositionsServer) error {
	ctx := stream.Context()

	// Maintain open read-loop per client connection channel [cite: 30]
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			// Client gracefully severed stream channel
			return stream.SendAndClose(&pb.IngestionResponse{
				Success:    true,
				RecordedAt: time.Now().Unix(),
			})
		}
		if err != nil {
			return status.Errorf(codes.Internal, "stream broken by ingestion error: %v", err)
		}

		// Transform incoming Protobuf primitives to our internal domain models
		domainLoc := &domain.DriverLocation{
			DriverID:   req.DriverId,
			CityPrefix: req.CityPrefix,
			Latitude:   req.Latitude,
			Longitude:  req.Longitude,
			Bearing:    req.Bearing,
			SpeedKMS:   req.SpeedKms,
			Timestamp:  time.Unix(req.TimestampUtc, 0),
		}

		// Forward task immediately to asynchronous workers
		err = h.useCase.ProcessLocationUpdate(ctx, domainLoc)
		if err != nil {
			// Failures in caching drop connections to allow auto-recovery via KEDA/K8s loops [cite: 33, 94]
			return status.Errorf(codes.Unavailable, "ingestion backend storage failover: %v", err)
		}
	}
}
