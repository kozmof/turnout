package ast

// ────────────────────────────────────────────────────────────
// Route / Match
// ────────────────────────────────────────────────────────────

// RouteBlock is the `route "<id>" { entry "<scene_id>" match { ... } }` top-level block.
type RouteBlock struct {
	Pos          Pos
	ID           string
	EntrySceneID string
	Match        *MatchBlock
}

// MatchBlock is the `match { <arms...> }` inside a route block.
type MatchBlock struct {
	Pos  Pos
	Arms []*MatchArm
}

// MatchArm is one `<path-expr> => <scene_id>` arm (possibly OR-joined branches).
type MatchArm struct {
	Pos      Pos
	Branches []*PathExpr // one or more branches joined with |
	Target   string      // scene_id target
}

// PathExpr is one path-form in a match arm.
// Fallback == true means the _ pattern.
// Otherwise SceneID + Segments describe the path (Segments may contain "*").
type PathExpr struct {
	Pos      Pos
	Fallback bool
	SceneID  string
	Segments []string // e.g. ["*", "final_action"] for scene_id.*.final_action
}
