# Offline OpenStreetMap Pipeline for Contraction Hierarchy Routing

This document describes the **offline data pipeline** that prepares
OpenStreetMap (OSM) road data for the dispatch routing service.

The goal of the offline phase is to convert a raw `.osm.pbf` extract
(e.g., an India / Eastern-zone extract) into two flat CSV files:

- `kolkata_nodes.csv`
- `kolkata_edges.csv`

These files are loaded at runtime by `internal/routing/graph/loader.go`
into the `ContractionHierarchiesService`.

> Note: The first version uses a **plain road graph** (no shortcuts,
> no real CH ordering yet). All CH work remains offline and can be
> added later without changing the runtime loader.

---

## 1. High-Level Architecture

### Offline Phase (data prep)

1. Download OSM `.osm.pbf` extract (e.g., from Geofabrik).  
2. (Optional) Use Osmium to clip and filter data.  
3. Run a Go preprocessor (`cmd/osm-preprocessor`) that:
   - Parses the `.osm.pbf` file.
   - Extracts nodes and road ways.
   - Computes edge weights (travel time in seconds).
   - Writes `kolkata_nodes.csv` and `kolkata_edges.csv`.

### Runtime Phase (service startup)

1. `cmd/dispatch/main.go` reads dataset paths from env:
   - `OSM_NODES_DATA_PATH`
   - `OSM_EDGES_DATA_PATH`
2. `graph.GraphLoader` streams the CSVs into memory:
   - `loadNodes` → `ContractionHierarchiesService.AddNode`
   - `loadEdges` → `ContractionHierarchiesService.AddEdge`
3. Routing uses the in-memory graph for low-latency lookups.

---

## 2. Data Sources

### 2.1 Download OSM extract

We use Geofabrik’s India extracts.[web:22]

1. Open:  
   - [India – Geofabrik OSM download page][web:22]
2. Choose either:
   - `india-latest.osm.pbf` (entire India), or
   - A sub-region `.osm.pbf` (e.g., Eastern Zone) that contains Kolkata.
3. Save the file into the repo under:

```text
C:\workspace\Driver\data\kolkata_raw.osm.pbf
```

> The filename is arbitrary; we conventionally use `kolkata_raw.osm.pbf`.

---

## 3. WSL + Osmium Setup (Data Filtering)

**Requirements:**

- WSL (Ubuntu) installed on the same machine as the repo.
- Osmium Tool installed inside WSL.[web:61]

### 3.1 Install Osmium

In WSL (Ubuntu):

```bash
sudo apt update
sudo apt install -y osmium-tool
osmium --version
```

You should see a version string like `osmium-tool 1.x`.

### 3.2 Copy the `.osm.pbf` into WSL

From WSL:

```bash
mkdir -p ~/osm
cp /mnt/c/workspace/Driver/data/kolkata_raw.osm.pbf ~/osm/kolkata_raw.osm.pbf
cd ~/osm
ls -lh
```

You should see:

```text
kolkata_raw.osm.pbf  ~231M
```

### 3.3 (Optional) Extract BBox and Filter Roads

If you want to reduce the dataset size, you can:

1. Extract a bounding box around Kolkata:

```bash
osmium extract --strategy=complete_ways \
  --bbox 88.25,22.45,88.45,22.70 \
  kolkata_raw.osm.pbf \
  -o kolkata_bbox.osm.pbf
```

2. Keep only drivable highways using `osmium tags-filter`:[web:61][web:27]

```bash
osmium tags-filter kolkata_bbox.osm.pbf \
  w/highway=motorway,trunk,primary,secondary,tertiary,unclassified,residential,service \
  -o kolkata_roads.osm.pbf -f pbf
```

This yields:

```text
kolkata_raw.osm.pbf   ~231M  (original extract)
kolkata_bbox.osm.pbf  ~20M   (bbox)
kolkata_roads.osm.pbf ~4.2M  (bbox + roads only)
```

For *full coverage* (e.g., use the 231 MB file), you can skip the bbox
and filtering and run the Go preprocessor directly on `kolkata_raw.osm.pbf`.

---

## 4. Go Offline Preprocessor (`cmd/osm-preprocessor`)

The offline preprocessor is a small Go command that reads a `.osm.pbf`
and writes `kolkata_nodes.csv` and `kolkata_edges.csv`.

### 4.1 Dependency: `osmpbf`

We use `github.com/qedus/osmpbf`, a Go library for decoding OSM PBF.[web:28][web:44]

Install it from the repo root:

```powershell
cd C:\workspace\Driver
go get github.com/qedus/osmpbf
```

### 4.2 Input / Output Locations

By convention:

- Input (full file):

```text
.\data\kolkata_full.osm.pbf
```

- Output:

```text
.\data\kolkata_nodes.csv
.\data\kolkata_edges.csv
```

In WSL:

```bash
cp ~/osm/kolkata_raw.osm.pbf /mnt/c/workspace/Driver/data/kolkata_full.osm.pbf
```

### 4.3 Command Layout

Create:

```text
cmd/osm-preprocessor/main.go
```

Example implementation (simplified but working):

```go
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
    inputPath := "./data/kolkata_full.osm.pbf"
    nodesCSV := "./data/kolkata_nodes.csv"
    edgesCSV := "./data/kolkata_edges.csv"

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
            "0", // placeholder importance
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
            "0", // no shortcuts in v1
        }
        if err := w.Write(row); err != nil {
            return err
        }
    }
    return nil
}
```

### 4.4 Running the Preprocessor

From the repo root:

```powershell
cd C:\workspace\Driver
go run cmd\osm-preprocessor\main.go
```

This will process the full `.osm.pbf` (231 MB); it can take some time.

Expected output:

```text
Wrote <N> nodes, <M> edges
```

Two CSVs should appear in `.\data`:

- `kolkata_nodes.csv`
- `kolkata_edges.csv`

---

## 5. Runtime Loader Integration

The runtime loader lives in `internal/routing/graph/loader.go`. It
streams nodes and edges from CSV using buffered readers and populates
the `ContractionHierarchiesService`.

### 5.1 Env variables

Runtime uses:

- `OSM_NODES_DATA_PATH` (default `./data/kolkata_nodes.csv`)
- `OSM_EDGES_DATA_PATH` (default `./data/kolkata_edges.csv`)

Example for local development:

```powershell
$env:OSM_NODES_DATA_PATH = "./data/kolkata_nodes.csv"
$env:OSM_EDGES_DATA_PATH = "./data/kolkata_edges.csv"
```

### 5.2 Loader Initialization in `cmd/dispatch/main.go`

Key snippet:

```go
nodesPath := getEnv("OSM_NODES_DATA_PATH", "./data/kolkata_nodes.csv")
edgesPath := getEnv("OSM_EDGES_DATA_PATH", "./data/kolkata_edges.csv")

chService := graph.NewContractionHierarchiesService()
graphLoader := graph.NewGraphLoader(chService)

if _, err := os.Stat(nodesPath); err == nil {
    loadCtx, loadCancel := context.WithTimeout(ctx, 30*time.Second)
    defer loadCancel()

    if err := graphLoader.IngestContractedTopology(loadCtx, nodesPath, edgesPath); err != nil {
        log.Fatalf("Critical error during road network graph initialization: %v", err)
    }
} else {
    log.Printf("[WARNING] Dataset files missing at %s. Bootstrapping container with minimum local seed node configurations.", nodesPath)
    chService.AddNode(&graph.CHNode{
        ID:        1001,
        Latitude:  22.5726,
        Longitude: 88.3639,
        Order:     1,
    })
}
```

### 5.3 Loader Implementation (`internal/routing/graph/loader.go`)

Structure summary:

- `GraphLoader.IngestContractedTopology`:
  - Calls `loadNodes(ctx, nodesCSVPath)`
  - Calls `loadEdges(ctx, edgesCSVPath)`

- `loadNodes`:
  - Opens CSV
  - Skips header
  - Parses `id, latitude, longitude, importance_order`
  - Calls `routingService.AddNode(&CHNode{...})`

- `loadEdges`:
  - Opens CSV
  - Skips header
  - Parses `from_node_id, to_node_id, weight_seconds, is_shortcut`
  - Calls `routingService.AddEdge(fromID, toID, weight, isShortcut)`

The CSV format produced by `osm-preprocessor` matches this layout.

---

## 6. Toolchain Notes (Windows)

Some Windows environments require extra configuration for Go builds
when `gcc` / MinGW is present.

### 6.1 Ensure 64-bit Go

Check:

```powershell
go env GOARCH GOOS
```

For this project, we use:

- `GOARCH=amd64`
- `GOOS=windows`

### 6.2 Optional: Disable CGO

If `gcc` / MinGW causes linker errors (e.g., `cannot find -lm`):

```powershell
setx CGO_ENABLED 0
```

Open a new PowerShell window and verify:

```powershell
go env CGO_ENABLED GOARCH GOOS
```

Now building the dispatch binary should not invoke `gcc` at all:

```powershell
cd C:\workspace\Driver
go build ./cmd/dispatch
```

Then run:

```powershell
$env:OSM_NODES_DATA_PATH = "./data/kolkata_nodes.csv"
$env:OSM_EDGES_DATA_PATH = "./data/kolkata_edges.csv"
.\dispatch.exe
```

---

## 7. Future Work: True Contraction Hierarchies

The current pipeline builds a **plain directed road graph**:

- `importance_order` is set to `0` for all nodes.
- `is_shortcut` is `0` for all edges.

To upgrade to full Contraction Hierarchies:

1. Implement node importance ordering in the offline preprocessor.
2. Run CH contraction offline:
   - Add shortcut edges.
   - Set `is_shortcut=1` for such edges.
   - Fill `importance_order` with actual ranks.
3. Keep the CSV format identical so the runtime loader remains unchanged.

This can be added as a second phase of `osm-preprocessor` or as a
separate offline tool.

---

## 8. Quick Recap

1. Download `.osm.pbf` from Geofabrik (India / Eastern zone).[web:22]  
2. (Optionally) clip and filter with Osmium.[web:61][web:27]  
3. Run `cmd/osm-preprocessor` to build `kolkata_nodes.csv` and `kolkata_edges.csv` from the full file using `osmpbf`.[web:28][web:44]  
4. Set `OSM_NODES_DATA_PATH` and `OSM_EDGES_DATA_PATH` and start the dispatch service.  
5. Routing now runs on a real city-scale OSM road graph with offline-prepared weights.
