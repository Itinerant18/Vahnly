package grpc_test

import (
	"context"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	telemetrygrpc "github.com/platform/driver-delivery/internal/telemetry/delivery/grpc"
	"github.com/platform/driver-delivery/internal/telemetry/domain"
	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1"
)

// mockTelemetryUseCase mock implementation of domain.TelemetryUseCase
type mockTelemetryUseCase struct {
	processed chan *domain.DriverLocation
	err       error
}

func (m *mockTelemetryUseCase) ProcessLocationUpdate(ctx context.Context, loc *domain.DriverLocation) error {
	if m.err != nil {
		return m.err
	}
	m.processed <- loc
	return nil
}

func TestClientStreamPositions_Success(t *testing.T) {
	// 1. Setup in-memory gRPC listener
	const bufSize = 1024 * 1024
	lis := bufconn.Listen(bufSize)
	
	mockUC := &mockTelemetryUseCase{
		processed: make(chan *domain.DriverLocation, 5),
	}
	handler := telemetrygrpc.NewLocationIngestionHandler(mockUC)

	srv := grpc.NewServer()
	pb.RegisterLocationIngestionServiceServer(srv, handler)
	go func() {
		if err := srv.Serve(lis); err != nil {
			panic(err)
		}
	}()
	defer srv.Stop()

	// 2. Setup Client connection
	ctx := context.Background()
	conn, err := grpc.DialContext(ctx, "bufnet", 
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return lis.Dial()
		}), 
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("Failed to dial bufnet: %v", err)
	}
	defer conn.Close()

	client := pb.NewLocationIngestionServiceClient(conn)

	// 3. Open client stream
	stream, err := client.ClientStreamPositions(ctx)
	if err != nil {
		t.Fatalf("Failed to open ClientStreamPositions stream: %v", err)
	}

	// 4. Send test payload
	testPayload := &pb.IngestionRequest{
		DriverId:     "driver-123",
		CityPrefix:   "NYC",
		Latitude:     40.7128,
		Longitude:    -74.0060,
		Bearing:      180.0,
		SpeedKms:     45.5,
		TimestampUtc: time.Now().Unix(),
	}

	if err := stream.Send(testPayload); err != nil {
		t.Fatalf("Failed to send ingestion request: %v", err)
	}

	// Wait for use-case processing
	select {
	case processedLoc := <-mockUC.processed:
		if processedLoc.DriverID != testPayload.DriverId {
			t.Errorf("Expected DriverID %s, got %s", testPayload.DriverId, processedLoc.DriverID)
		}
		if processedLoc.CityPrefix != testPayload.CityPrefix {
			t.Errorf("Expected CityPrefix %s, got %s", testPayload.CityPrefix, processedLoc.CityPrefix)
		}
		if processedLoc.Latitude != testPayload.Latitude {
			t.Errorf("Expected Latitude %f, got %f", testPayload.Latitude, processedLoc.Latitude)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for location update to be processed")
	}

	// Close stream
	resp, err := stream.CloseAndRecv()
	if err != nil {
		t.Fatalf("Failed to close and recv: %v", err)
	}

	if !resp.Success {
		t.Errorf("Expected success response, got false")
	}
}
