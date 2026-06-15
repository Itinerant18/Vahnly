package client

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	triton "github.com/platform/driver-delivery/pkg/api/triton"
)

type TritonClient struct {
	grpcConn *grpc.ClientConn
	api      triton.GRPCInferenceServiceClient
}

func NewTritonClient(addr string) (*TritonClient, error) {
	// Configure aggressive keepalive settings to keep persistent sockets warm across container boundaries
	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                60 * time.Second,
			Timeout:             5 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("failed connecting to Triton Inference cluster: %w", err)
	}

	return &TritonClient{
		grpcConn: conn,
		api:      triton.NewGRPCInferenceServiceClient(conn),
	}, nil
}

// PredictETAMultiplier packages tabular spatial features into Triton tensors for XGBoost evaluation
func (c *TritonClient) PredictETAMultiplier(ctx context.Context, modelName, modelVersion string, features []float32) (float32, error) {
	// XGBoost models inside Triton typically look for a 2D tensor shaped [1, NumberOfFeatures]
	numFeatures := int64(len(features))

	// Pack float32 slice directly into a sequence of raw little-endian bytes
	byteBuffer := make([]byte, numFeatures*4)
	for i, f := range features {
		binary.LittleEndian.PutUint32(byteBuffer[i*4:(i+1)*4], math.Float32bits(f))
	}

	// Format request input tensor array metadata mapping Triton specifications
	inputTensor := &triton.ModelInferRequest_InferInputTensor{
		Name:     "input__0", // Matches config.pbtxt entry parameters
		Datatype: "FP32",
		Shape:    []int64{1, numFeatures},
	}

	request := &triton.ModelInferRequest{
		ModelName:        modelName,
		ModelVersion:     modelVersion,
		Inputs:           []*triton.ModelInferRequest_InferInputTensor{inputTensor},
		RawInputContents: [][]byte{byteBuffer},
	}

	// Fire remote evaluation call over warm gRPC channel paths
	response, err := c.api.ModelInfer(ctx, request)
	if err != nil {
		return 1.0, fmt.Errorf("triton_inference_failed: %w", err)
	}

	if len(response.RawOutputContents) == 0 {
		return 1.0, fmt.Errorf("triton_returned_empty_tensor_payload")
	}

	// Unpack float32 prediction from output raw binary stream blocks
	outputBytes := response.RawOutputContents[0]
	if len(outputBytes) < 4 {
		return 1.0, fmt.Errorf("output_bytes_truncated")
	}

	bits := binary.LittleEndian.Uint32(outputBytes[0:4])
	multiplier := math.Float32frombits(bits)

	return multiplier, nil
}

func (c *TritonClient) Close() error {
	return c.grpcConn.Close()
}
