package main

import (
	"encoding/csv"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"

	"github.com/qedus/osmpbf"
)

type Node struct {
	ID  int64
	Lat float64
	Lon float64
}

type Edge struct {
	FromID int64
	ToID   int64
	Weight float64 // seconds
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000.0
	phi1 := lat1 * math.Pi / 180
	phi2 := lat2 * math.Pi / 180
	dphi := (lat2 - lat1) * math.Pi / 180
	dlambda := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(dphi/2)*math.Sin(dphi/2) +
		math.Cos(phi1)*math.Cos(phi2)*math.Sin(dlambda/2)*math.Sin(dlambda/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func speedForHighway(hw string) float64 {
	switch hw {
	case "motorway", "trunk":
		return 27.78 // 100 km/h
	case "primary":
		return 22.22 // 80 km/h
	case "secondary":
		return 19.44 // 70 km/h
	case "tertiary":
		return 16.67 // 60 km/h
	case "unclassified", "residential", "service":
		return 11.11 // 40 km/h
	default:
		return 10
	}
}

func main() {
	// Use the full 231 MB file
	inputPath := "./data/kolkata_full.osm.pbf"
	nodesCSV := "./data/kolkata_nodes.csv"
	edgesCSV := "./data/kolkata_edges.csv"

	// use the 4.2 mb file for ram sortage
	// inputPath := "./data/kolkata_roads.osm.pbf"
	// nodesCSV := "./data/kolkata_nodes.csv"
	// edgesCSV := "./data/kolkata_edges.csv"

	f, err := os.Open(inputPath)
	if err != nil {
		log.Fatalf("open PBF: %v", err)
	}
	defer f.Close()

	dec := osmpbf.NewDecoder(f)
	dec.SetBufferSize(osmpbf.MaxBlobSize)
	if err := dec.Start(0); err != nil {
		log.Fatalf("decoder start: %v", err)
	}

	nodes := make(map[int64]*Node)
	var edges []Edge

	for {
		v, err := dec.Decode()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			log.Fatalf("decode: %v", err)
		}

		switch obj := v.(type) {
		case *osmpbf.Node:
			nodes[obj.ID] = &Node{
				ID:  obj.ID,
				Lat: obj.Lat,
				Lon: obj.Lon,
			}

		case *osmpbf.Way:
			var hwType string
			var oneway string
			for k, v := range obj.Tags {
				if k == "highway" {
					hwType = v
				}
				if k == "oneway" {
					oneway = v
				}
			}
			if hwType == "" {
				continue
			}

			speed := speedForHighway(hwType)
			if speed <= 0 {
				continue
			}

			for i := 0; i+1 < len(obj.NodeIDs); i++ {
				fromID := obj.NodeIDs[i]
				toID := obj.NodeIDs[i+1]
				fromNode, ok1 := nodes[fromID]
				toNode, ok2 := nodes[toID]
				if !ok1 || !ok2 {
					continue
				}
				dist := haversine(fromNode.Lat, fromNode.Lon, toNode.Lat, toNode.Lon)
				weightSec := dist / speed

				edges = append(edges, Edge{FromID: fromID, ToID: toID, Weight: weightSec})
				if oneway != "yes" && oneway != "1" {
					edges = append(edges, Edge{FromID: toID, ToID: fromID, Weight: weightSec})
				}
			}
		}
	}

	if err := writeNodesCSV(nodesCSV, nodes); err != nil {
		log.Fatalf("write nodes csv: %v", err)
	}
	if err := writeEdgesCSV(edgesCSV, edges); err != nil {
		log.Fatalf("write edges csv: %v", err)
	}

	fmt.Printf("Wrote %d nodes, %d edges\n", len(nodes), len(edges))
}

func writeNodesCSV(path string, nodes map[int64]*Node) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := csv.NewWriter(f)
	defer w.Flush()

	if err := w.Write([]string{"id", "latitude", "longitude", "importance_order"}); err != nil {
		return err
	}
	for _, n := range nodes {
		row := []string{
			strconv.FormatInt(n.ID, 10),
			strconv.FormatFloat(n.Lat, 'f', 6, 64),
			strconv.FormatFloat(n.Lon, 'f', 6, 64),
			"0",
		}
		if err := w.Write(row); err != nil {
			return err
		}
	}
	return nil
}

func writeEdgesCSV(path string, edges []Edge) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := csv.NewWriter(f)
	defer w.Flush()

	if err := w.Write([]string{"from_node_id", "to_node_id", "weight_seconds", "is_shortcut"}); err != nil {
		return err
	}
	for _, e := range edges {
		row := []string{
			strconv.FormatInt(e.FromID, 10),
			strconv.FormatInt(e.ToID, 10),
			strconv.FormatFloat(e.Weight, 'f', 2, 64),
			"0",
		}
		if err := w.Write(row); err != nil {
			return err
		}
	}
	return nil
}
