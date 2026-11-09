CREATE TABLE work_access (
    work TEXT NOT NULL REFERENCES records(id),
    user TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY(work,user)
);
CREATE INDEX work_access_user ON work_access(user,work);
CREATE INDEX records_parent ON records(org,parent,archived);
CREATE INDEX history_task ON history(org,task,created);
CREATE INDEX sessions_expires ON sessions(expires);
CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    org TEXT NOT NULL REFERENCES organizations(id),
    actor TEXT NOT NULL REFERENCES users(id),
    record TEXT REFERENCES records(id),
    action TEXT NOT NULL,
    created TEXT NOT NULL
);
CREATE INDEX audit_org_created ON audit_events(org,created DESC);
