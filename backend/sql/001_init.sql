CREATE TABLE IF NOT EXISTS watch_history (
    actor_id CHAR(64) NOT NULL,
    video_id VARCHAR(80) NOT NULL,
    video_url TEXT NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'xvideos' CHECK (source = 'xvideos'),
    played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (actor_id, video_id)
);
ALTER TABLE watch_history ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'xvideos' CHECK (source = 'xvideos');
ALTER TABLE watch_history DROP CONSTRAINT IF EXISTS watch_history_source_check;
ALTER TABLE watch_history ADD CONSTRAINT watch_history_source_check CHECK (source = 'xvideos');
CREATE INDEX IF NOT EXISTS watch_history_actor_time_idx
    ON watch_history (actor_id, played_at DESC);

CREATE TABLE IF NOT EXISTS favorites (
    actor_id CHAR(64) NOT NULL,
    video_id VARCHAR(80) NOT NULL,
    video_url TEXT NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'xvideos' CHECK (source = 'xvideos'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (actor_id, video_id)
);
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'xvideos' CHECK (source = 'xvideos');
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_source_check;
ALTER TABLE favorites ADD CONSTRAINT favorites_source_check CHECK (source = 'xvideos');
CREATE INDEX IF NOT EXISTS favorites_actor_time_idx
    ON favorites (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tag_equivalences (
    actor_id CHAR(64) NOT NULL,
    source_tag TEXT NOT NULL,
    equivalent_tag TEXT NOT NULL,
    decision VARCHAR(8) NOT NULL CHECK (decision IN ('include', 'exclude')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (actor_id, source_tag, equivalent_tag)
);
CREATE INDEX IF NOT EXISTS tag_equivalences_actor_idx
    ON tag_equivalences (actor_id, decision, source_tag);
