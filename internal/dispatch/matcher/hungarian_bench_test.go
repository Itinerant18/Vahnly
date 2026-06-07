package matcher

import (
	"math/rand"
	"testing"
)

func BenchmarkSolveKuhnMunkres(b *testing.B) {
	n := 100
	matrix := make([][]float64, n)
	for i := 0; i < n; i++ {
		matrix[i] = make([]float64, n)
		for j := 0; j < n; j++ {
			matrix[i][j] = rand.Float64() * 100
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		SolveKuhnMunkres(matrix)
	}
}
