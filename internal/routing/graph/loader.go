package graph

import (
	"bufio"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
)

type GraphLoader struct {
	routingService *ContractionHierarchiesService
}

func NewGraphLoader(svc *ContractionHierarchiesService) *GraphLoader {
	return &GraphLoader{routingService: svc}
}

// IngestContractedTopology Streams flat pre-contracted CSV nodes and edge maps into memory layout caches
func (l *GraphLoader) IngestContractedTopology(ctx context.Context, nodesCSVPath, edgesCSVPath string) error {
	log.Printf("[GRAPH_LOADER] Commencing city-scale topology hydration...")

	// 1. Stream Node Array Maps
	if err := l.loadNodes(ctx, nodesCSVPath); err != nil {
		return fmt.Errorf("failed hydrating graph nodes dataset: %w", err)
	}

	// 2. Stream Edge Array Maps
	if err := l.loadEdges(ctx, edgesCSVPath); err != nil {
		return fmt.Errorf("failed hydrating graph edges dataset: %w", err)
	}

	log.Printf("[GRAPH_LOADER] Successful data load. Total Nodes Cached: %d", len(l.routingService.nodes))
	return nil
}

func (l *GraphLoader) loadNodes(ctx context.Context, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	// Wrap in a buffered reader to process line-by-line efficiently
	reader := csv.NewReader(bufio.NewReader(file))

	// Skip header line block: id,latitude,longitude,importance_order
	if _, err := reader.Read(); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		// Unpack primitive indices matching structural node layouts
		id, _ := strconv.ParseInt(record[0], 10, 64)
		lat, _ := strconv.ParseFloat(record[1], 64)
		lng, _ := strconv.ParseFloat(record[2], 64)
		order, _ := strconv.Atoi(record[3])

		l.routingService.AddNode(&CHNode{
			ID:        id,
			Latitude:  lat,
			Longitude: lng,
			Order:     order,
		})
	}
	return nil
}

func (l *GraphLoader) loadEdges(ctx context.Context, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(bufio.NewReader(file))

	// Skip header line block: from_node_id,to_node_id,weight_seconds,is_shortcut
	if _, err := reader.Read(); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		fromID, _ := strconv.ParseInt(record[0], 10, 64)
		toID, _ := strconv.ParseInt(record[1], 10, 64)
		weight, _ := strconv.ParseFloat(record[2], 64)
		isShortcut := record[3] == "1" || record[3] == "true"

		// AddEdge maps forward or backward hierarchies automatically
		l.routingService.AddEdge(fromID, toID, weight, isShortcut)
	}
	return nil
}
