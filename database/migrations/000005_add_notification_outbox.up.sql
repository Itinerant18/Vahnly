-- Track native mobile device tokens mapped to active system entities
CREATE TABLE user_device_tokens (
	user_id UUID PRIMARY KEY,
	device_token VARCHAR(255) NOT NULL,
	platform_type VARCHAR(20) NOT NULL, -- 'ANDROID_FCM', 'IOS_APNS'
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Transactional Append-Only Outbox Table
CREATE TABLE notification_outbox (
	id BIGSERIAL PRIMARY KEY,
	user_id UUID NOT NULL,
	title VARCHAR(150) NOT NULL,
	body TEXT NOT NULL,
	payload JSONB NOT NULL,
	status VARCHAR(20) DEFAULT 'PENDING' NOT NULL, -- 'PENDING', 'SENT', 'FAILED'
	retry_count INT DEFAULT 0 NOT NULL,
	error_log TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
	processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_notification_outbox_status ON notification_outbox(status) WHERE status = 'PENDING';
CREATE INDEX idx_user_device_tokens_lookup ON user_device_tokens(user_id);
