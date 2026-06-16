package http

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/platform/driver-delivery/internal/storage/objectstore"
)

const maxPhotoBytes = 5 << 20 // 5MB cap on the uploaded image.

// PhotoHandler serves the rider profile-photo upload, streaming the image to the
// shared S3-compatible object store and returning its public URL.
type PhotoHandler struct {
	objStore *objectstore.S3Store
	logger   *log.Logger
}

func NewPhotoHandler(objStore *objectstore.S3Store, logger *log.Logger) *PhotoHandler {
	return &PhotoHandler{objStore: objStore, logger: logger}
}

// HandleUploadPhoto accepts a multipart/form-data "file" image field, uploads it
// to S3 under rider-photos/{riderID}/{ts}.jpg, and returns {url}.
func (h *PhotoHandler) HandleUploadPhoto(w http.ResponseWriter, r *http.Request) {
	riderID, ok := riderIDFromContext(w, r)
	if !ok {
		return
	}
	// When uploads aren't configured the frontend falls back to a local path.
	if h.objStore == nil || !h.objStore.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "uploads not configured", "ERR_UNAVAILABLE")
		return
	}

	if err := r.ParseMultipartForm(6 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form", "ERR_BAD_REQUEST")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required", "ERR_VALIDATION")
		return
	}
	defer file.Close()

	// Read at most maxPhotoBytes+1 so an oversized image is rejected without
	// buffering the whole body.
	body, err := io.ReadAll(io.LimitReader(file, maxPhotoBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read file", "ERR_BAD_REQUEST")
		return
	}
	if len(body) > maxPhotoBytes {
		writeError(w, http.StatusBadRequest, "image exceeds 5MB limit", "ERR_VALIDATION")
		return
	}

	contentType := http.DetectContentType(body)
	if !strings.HasPrefix(contentType, "image/") {
		writeError(w, http.StatusBadRequest, "file must be an image", "ERR_VALIDATION")
		return
	}

	key := fmt.Sprintf("rider-photos/%s/%d.jpg", riderID, time.Now().UnixNano())
	url, err := h.objStore.PutObject(r.Context(), key, body, contentType)
	if err != nil {
		if h.logger != nil {
			h.logger.Printf("[RIDER_PHOTO] upload error: %v", err)
		}
		writeError(w, http.StatusInternalServerError, "upload failed", "ERR_INTERNAL")
		return
	}

	writeData(w, http.StatusOK, map[string]string{"url": url})
}
