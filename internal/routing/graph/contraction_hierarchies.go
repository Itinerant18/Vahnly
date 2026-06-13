package graph

import (
	"container/heap"
	"context"
	"errors"
	"math"
)

// CHNode represents a preprocessed vertex in the city's road graph
type CHNode struct {
	ID        int64
	Latitude  float64
	Longitude float64
	Order     int // Core CH property: Importance rank assigned during preprocessing
}

// CHEdge defines a directed relationship with structural weight
type CHEdge struct {
	To         int64
	Weight     float64 // Represents travel time in seconds adjusted by the velocity matrix
	IsShortcut bool
}

type ContractionHierarchiesService struct {
	nodes         map[int64]*CHNode
	forwardGraph  map[int64][]CHEdge
	backwardGraph map[int64][]CHEdge
}

func NewContractionHierarchiesService() *ContractionHierarchiesService {
	return &ContractionHierarchiesService{
		nodes:         make(map[int64]*CHNode),
		forwardGraph:  make(map[int64][]CHEdge),
		backwardGraph: make(map[int64][]CHEdge),
	}
}

// AddNode registers a preprocessed node in the service
func (s *ContractionHierarchiesService) AddNode(node *CHNode) {
	s.nodes[node.ID] = node
}

// GetNode retrieves a preprocessed node by its ID
func (s *ContractionHierarchiesService) GetNode(id int64) (*CHNode, bool) {
	node, exists := s.nodes[id]
	return node, exists
}

// AddEdge registers a directed edge between two nodes in the CH graph.
// It populates the forward or backward graphs depending on Node hierarchy order.
func (s *ContractionHierarchiesService) AddEdge(fromID, toID int64, weight float64, isShortcut bool) {
	fromNode := s.nodes[fromID]
	toNode := s.nodes[toID]
	if fromNode == nil || toNode == nil {
		return
	}

	// Bidirectional Dijkstra search only moves upward along the hierarchy order.
	if toNode.Order > fromNode.Order {
		s.forwardGraph[fromID] = append(s.forwardGraph[fromID], CHEdge{
			To:         toID,
			Weight:     weight,
			IsShortcut: isShortcut,
		})
	}
	if fromNode.Order > toNode.Order {
		s.backwardGraph[toID] = append(s.backwardGraph[toID], CHEdge{
			To:         fromID,
			Weight:     weight,
			IsShortcut: isShortcut,
		})
	}
}

// Item defines the layout for our path priority queue
type Item struct {
	nodeID   int64
	priority float64
	index    int
}

type PriorityQueue []*Item

func (pq PriorityQueue) Len() int           { return len(pq) }
func (pq PriorityQueue) Less(i, j int) bool { return pq[i].priority < pq[j].priority }
func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}
func (pq *PriorityQueue) Push(x interface{}) {
	n := len(*pq)
	item := x.(*Item)
	item.index = n
	*pq = append(*pq, item)
}
func (pq *PriorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	item.index = -1
	*pq = old[0 : n-1]
	return item
}

// ComputeShortestPathETA runs an upward-only bidirectional Dijkstra search on the CH graph topology
func (s *ContractionHierarchiesService) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	if sourceID == targetID {
		return 0.0, nil
	}

	// Local search state arrays initialized to infinity
	forwardDist := make(map[int64]float64)
	backwardDist := make(map[int64]float64)

	forwardDist[sourceID] = 0.0
	backwardDist[targetID] = 0.0

	pqForward := &PriorityQueue{{nodeID: sourceID, priority: 0.0}}
	pqBackward := &PriorityQueue{{nodeID: targetID, priority: 0.0}}

	heap.Init(pqForward)
	heap.Init(pqBackward)

	bestEstimate := math.MaxFloat64

	// Loop until both search trees are empty
	for pqForward.Len() > 0 || pqBackward.Len() > 0 {
		select {
		case <-ctx.Done():
			return 0.0, ctx.Err()
		default:
		}

		// 1. Forward Search Step (Moving upward from Source)
		if pqForward.Len() > 0 {
			curr := heap.Pop(pqForward).(*Item)
			u := curr.nodeID
			uDist := curr.priority

			if uDist <= forwardDist[u] {
				for _, edge := range s.forwardGraph[u] {
					v := edge.To
					alt := uDist + edge.Weight

					if d, ok := forwardDist[v]; !ok || alt < d {
						forwardDist[v] = alt
						heap.Push(pqForward, &Item{nodeID: v, priority: alt})

						// Check meeting intersection point
						if backD, evaluated := backwardDist[v]; evaluated {
							if alt+backD < bestEstimate {
								bestEstimate = alt + backD
							}
						}
					}
				}
			}
		}

		// 2. Backward Search Step (Moving upward from Target)
		if pqBackward.Len() > 0 {
			curr := heap.Pop(pqBackward).(*Item)
			u := curr.nodeID
			uDist := curr.priority

			if uDist <= backwardDist[u] {
				for _, edge := range s.backwardGraph[u] {
					v := edge.To // In backward graph, this means edge coming from v to u
					alt := uDist + edge.Weight

					if d, ok := backwardDist[v]; !ok || alt < d {
						backwardDist[v] = alt
						heap.Push(pqBackward, &Item{nodeID: v, priority: alt})

						// Check meeting intersection point
						if forD, evaluated := forwardDist[v]; evaluated {
							if alt+forD < bestEstimate {
								bestEstimate = alt + forD
							}
						}
					}
				}
			}
		}
	}

	if bestEstimate == math.MaxFloat64 {
		return 0.0, errors.New("routing_error: unresolvable graph disconnected state")
	}

	return bestEstimate, nil
}
