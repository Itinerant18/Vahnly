package http

import (
	"fmt"
	"net/http"

	"github.com/go-pdf/fpdf"

	"github.com/platform/driver-delivery/internal/domain"
)

// HandleInvoice streams a one-page trip-invoice PDF for an order the authed rider
// owns. 404 if the order doesn't exist or belongs to another rider.
func (h *BookingHandler) HandleInvoice(w http.ResponseWriter, r *http.Request) {
	riderID, ok := h.riderID(w, r)
	if !ok {
		return
	}
	orderID := r.PathValue("orderId")

	order, err := h.booking.GetOrderByID(r.Context(), orderID)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	// Ownership check — never leak another rider's invoice.
	if order.RiderID == nil || *order.RiderID != riderID {
		writeError(w, http.StatusNotFound, "order not found", "ERR_NOT_FOUND")
		return
	}

	pdf := buildInvoicePDF(order)

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"invoice-%s.pdf\"", order.ID))
	if err := pdf.Output(w); err != nil && h.logger != nil {
		h.logger.Printf("[RIDER_BOOKING] invoice render error: %v", err)
	}
}

// rupees formats a paise amount as "₹1,234.56". The € glyph is unavailable in the
// core font, so the rupee symbol is rendered via the unicode translator below.
func rupees(paise int64) string {
	return fmt.Sprintf("Rs %.2f", float64(paise)/100)
}

func buildInvoicePDF(o *domain.RiderOrder) *fpdf.Fpdf {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	// Header.
	pdf.SetFont("Helvetica", "B", 18)
	pdf.Cell(0, 12, "Vahnly - Trip Invoice")
	pdf.Ln(16)

	pdf.SetFont("Helvetica", "", 11)
	pdf.Cell(40, 7, "Order ID:")
	pdf.Cell(0, 7, o.ID)
	pdf.Ln(7)

	pdf.Cell(40, 7, "Date:")
	pdf.Cell(0, 7, o.CreatedAt.Format("02 Jan 2006 15:04"))
	pdf.Ln(7)

	payment := "CASH"
	if o.PaymentMethod != nil && *o.PaymentMethod != "" {
		payment = *o.PaymentMethod
	}
	pdf.Cell(40, 7, "Payment Method:")
	pdf.Cell(0, 7, payment)
	pdf.Ln(12)

	// Fare breakdown table.
	pdf.SetFont("Helvetica", "B", 12)
	pdf.Cell(0, 8, "Fare Breakdown")
	pdf.Ln(10)

	pdf.SetFont("Helvetica", "", 11)
	row := func(label, value string) {
		pdf.CellFormat(120, 8, label, "B", 0, "L", false, 0, "")
		pdf.CellFormat(50, 8, value, "B", 0, "R", false, 0, "")
		pdf.Ln(8)
	}

	row("Base fare", rupees(o.BaseFarePaise))
	if o.PromoDiscountPaise > 0 {
		row("Promo discount", "- "+rupees(o.PromoDiscountPaise))
	}
	row("Surge multiplier", fmt.Sprintf("x%.2f", o.SurgeMultiplier))

	total := o.BaseFarePaise - o.PromoDiscountPaise
	if total < 0 {
		total = 0
	}
	pdf.SetFont("Helvetica", "B", 12)
	pdf.CellFormat(120, 9, "Total", "T", 0, "L", false, 0, "")
	pdf.CellFormat(50, 9, rupees(total), "T", 0, "R", false, 0, "")
	pdf.Ln(14)

	pdf.SetFont("Helvetica", "I", 9)
	pdf.Cell(0, 6, "Thank you for riding with Vahnly.")

	return pdf
}
