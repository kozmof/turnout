package localexpr_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

func ref(name string) *turnoutpb.LocalExprModel {
	return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Ref{
		Ref: &turnoutpb.LocalRefExprModel{Name: name},
	}}
}

func lit() *turnoutpb.LocalExprModel {
	return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Lit{
		Lit: &turnoutpb.LocalLitExprModel{},
	}}
}

func itNode() *turnoutpb.LocalExprModel {
	return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_It{
		It: &turnoutpb.LocalItExprModel{},
	}}
}

// ─── WalkProto edge cases ─────────────────────────────────────────────────────

func TestWalkProtoNilIsNoOp(t *testing.T) {
	var count int
	localexpr.WalkProto(nil, func(_ *turnoutpb.LocalExprModel) { count++ })
	if count != 0 {
		t.Fatalf("WalkProto(nil) called visitor %d times, want 0", count)
	}
}

func TestWalkProtoLeafNode(t *testing.T) {
	node := ref("x")
	var visited []*turnoutpb.LocalExprModel
	localexpr.WalkProto(node, func(n *turnoutpb.LocalExprModel) { visited = append(visited, n) })
	if len(visited) != 1 || visited[0] != node {
		t.Fatalf("WalkProto(leaf) visited %d nodes, want 1", len(visited))
	}
}

func TestWalkProtoVisitsAllNodesDepthFirst(t *testing.T) {
	// Build: if(cond=ref("a"), then=ref("b"), else=ref("c"))
	ifNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{
		IfExpr: &turnoutpb.LocalIfExprModel{
			Cond:       ref("a"),
			Then:       ref("b"),
			ElseBranch: ref("c"),
		},
	}}

	var names []string
	localexpr.WalkProto(ifNode, func(n *turnoutpb.LocalExprModel) {
		if r, ok := n.Expr.(*turnoutpb.LocalExprModel_Ref); ok {
			names = append(names, r.Ref.GetName())
		}
	})

	want := []string{"a", "b", "c"}
	if len(names) != len(want) {
		t.Fatalf("visited refs = %v, want %v", names, want)
	}
	for i, n := range names {
		if n != want[i] {
			t.Fatalf("names[%d] = %q, want %q", i, n, want[i])
		}
	}
}

// ─── ProtoChildren for each variant ──────────────────────────────────────────

func TestProtoChildrenNilReturnsNil(t *testing.T) {
	if children := localexpr.ProtoChildren(nil); children != nil {
		t.Fatalf("ProtoChildren(nil) = %v, want nil", children)
	}
}

func TestProtoChildrenLeafReturnsEmpty(t *testing.T) {
	for _, node := range []*turnoutpb.LocalExprModel{ref("x"), lit(), itNode()} {
		if ch := localexpr.ProtoChildren(node); len(ch) != 0 {
			t.Fatalf("ProtoChildren(leaf) = %v, want []", ch)
		}
	}
}

func TestProtoChildrenCall(t *testing.T) {
	a, b := ref("a"), ref("b")
	call := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Call{
		Call: &turnoutpb.LocalCallExprModel{
			Fn:   "add",
			Args: []*turnoutpb.LocalExprModel{a, b},
		},
	}}

	ch := localexpr.ProtoChildren(call)
	if len(ch) != 2 || ch[0] != a || ch[1] != b {
		t.Fatalf("ProtoChildren(call) = %v, want [a, b]", ch)
	}
}

func TestProtoChildrenCallNoArgs(t *testing.T) {
	call := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Call{
		Call: &turnoutpb.LocalCallExprModel{Fn: "noop"},
	}}
	if ch := localexpr.ProtoChildren(call); len(ch) != 0 {
		t.Fatalf("ProtoChildren(call, no args) = %v, want []", ch)
	}
}

func TestProtoChildrenInfix(t *testing.T) {
	lhs, rhs := ref("x"), ref("y")
	infix := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Infix{
		Infix: &turnoutpb.LocalInfixExprModel{Lhs: lhs, Rhs: rhs},
	}}

	ch := localexpr.ProtoChildren(infix)
	if len(ch) != 2 || ch[0] != lhs || ch[1] != rhs {
		t.Fatalf("ProtoChildren(infix) = %v, want [lhs, rhs]", ch)
	}
}

func TestProtoChildrenInfixNilSidesCompacted(t *testing.T) {
	// Only lhs set — rhs nil should be compacted out.
	infix := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Infix{
		Infix: &turnoutpb.LocalInfixExprModel{Lhs: ref("x"), Rhs: nil},
	}}
	ch := localexpr.ProtoChildren(infix)
	if len(ch) != 1 {
		t.Fatalf("ProtoChildren(infix, nil rhs) = %v, want [lhs]", ch)
	}
}

func TestProtoChildrenIfExpr(t *testing.T) {
	cond, then, els := ref("c"), ref("t"), ref("e")
	ifNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{
		IfExpr: &turnoutpb.LocalIfExprModel{Cond: cond, Then: then, ElseBranch: els},
	}}

	ch := localexpr.ProtoChildren(ifNode)
	if len(ch) != 3 || ch[0] != cond || ch[1] != then || ch[2] != els {
		t.Fatalf("ProtoChildren(if) = %v, want [cond, then, else]", ch)
	}
}

func TestProtoChildrenIfExprNilBranchCompacted(t *testing.T) {
	ifNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{
		IfExpr: &turnoutpb.LocalIfExprModel{Cond: ref("c"), Then: nil, ElseBranch: nil},
	}}
	ch := localexpr.ProtoChildren(ifNode)
	if len(ch) != 1 {
		t.Fatalf("ProtoChildren(if, nil branches) = %v, want [cond]", ch)
	}
}

func TestProtoChildrenCaseExprWithGuard(t *testing.T) {
	subject := ref("s")
	guard := ref("g")
	expr := ref("e")
	arm := &turnoutpb.LocalCaseArmModel{
		Guard: guard,
		Expr:  expr,
	}
	caseNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{
		CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: subject,
			Arms:    []*turnoutpb.LocalCaseArmModel{arm},
		},
	}}

	// Expected children: subject, guard, expr
	ch := localexpr.ProtoChildren(caseNode)
	if len(ch) != 3 || ch[0] != subject || ch[1] != guard || ch[2] != expr {
		t.Fatalf("ProtoChildren(case, with guard) = %v, want [subject, guard, expr]", ch)
	}
}

func TestProtoChildrenCaseExprNoGuard(t *testing.T) {
	subject := ref("s")
	expr := ref("e")
	arm := &turnoutpb.LocalCaseArmModel{Guard: nil, Expr: expr}
	caseNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{
		CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: subject,
			Arms:    []*turnoutpb.LocalCaseArmModel{arm},
		},
	}}

	// Expected children: subject, expr (guard compacted out)
	ch := localexpr.ProtoChildren(caseNode)
	if len(ch) != 2 || ch[0] != subject || ch[1] != expr {
		t.Fatalf("ProtoChildren(case, no guard) = %v, want [subject, expr]", ch)
	}
}

func TestProtoChildrenCaseExprMultipleArms(t *testing.T) {
	subject := ref("s")
	e1, e2 := ref("e1"), ref("e2")
	caseNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{
		CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: subject,
			Arms: []*turnoutpb.LocalCaseArmModel{
				{Guard: nil, Expr: e1},
				{Guard: nil, Expr: e2},
			},
		},
	}}

	ch := localexpr.ProtoChildren(caseNode)
	// subject + e1 + e2
	if len(ch) != 3 {
		t.Fatalf("ProtoChildren(case, 2 arms) = %v, want 3 children", ch)
	}
}

func TestProtoChildrenPipeExpr(t *testing.T) {
	initial := ref("init")
	step1, step2 := ref("s1"), ref("s2")
	pipeNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_PipeExpr{
		PipeExpr: &turnoutpb.LocalPipeExprModel{
			Initial: initial,
			Steps:   []*turnoutpb.LocalExprModel{step1, step2},
		},
	}}

	ch := localexpr.ProtoChildren(pipeNode)
	if len(ch) != 3 || ch[0] != initial || ch[1] != step1 || ch[2] != step2 {
		t.Fatalf("ProtoChildren(pipe) = %v, want [initial, step1, step2]", ch)
	}
}

func TestProtoChildrenPipeExprNoSteps(t *testing.T) {
	initial := ref("init")
	pipeNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_PipeExpr{
		PipeExpr: &turnoutpb.LocalPipeExprModel{Initial: initial},
	}}

	ch := localexpr.ProtoChildren(pipeNode)
	if len(ch) != 1 || ch[0] != initial {
		t.Fatalf("ProtoChildren(pipe, no steps) = %v, want [initial]", ch)
	}
}

// ─── WalkProto integration across node types ──────────────────────────────────

func TestWalkProtoCaseWithGuardVisitsAll(t *testing.T) {
	guard := ref("g")
	expr := ref("e")
	subject := ref("s")
	caseNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{
		CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: subject,
			Arms:    []*turnoutpb.LocalCaseArmModel{{Guard: guard, Expr: expr}},
		},
	}}

	var names []string
	localexpr.WalkProto(caseNode, func(n *turnoutpb.LocalExprModel) {
		if r, ok := n.Expr.(*turnoutpb.LocalExprModel_Ref); ok {
			names = append(names, r.Ref.GetName())
		}
	})

	// Walk visits caseNode root (not a ref), then subject("s"), guard("g"), expr("e")
	want := []string{"s", "g", "e"}
	if len(names) != len(want) {
		t.Fatalf("WalkProto(case) refs = %v, want %v", names, want)
	}
	for i, n := range names {
		if n != want[i] {
			t.Fatalf("names[%d] = %q, want %q", i, n, want[i])
		}
	}
}

func TestWalkProtoPipeVisitsAll(t *testing.T) {
	initial := ref("init")
	step := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Call{
		Call: &turnoutpb.LocalCallExprModel{
			Fn:   "inc",
			Args: []*turnoutpb.LocalExprModel{ref("x")},
		},
	}}
	pipeNode := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_PipeExpr{
		PipeExpr: &turnoutpb.LocalPipeExprModel{
			Initial: initial,
			Steps:   []*turnoutpb.LocalExprModel{step},
		},
	}}

	var count int
	localexpr.WalkProto(pipeNode, func(_ *turnoutpb.LocalExprModel) { count++ })
	// pipeNode + initial(ref) + step(call) + step.arg(ref) = 4
	if count != 4 {
		t.Fatalf("WalkProto(pipe) count = %d, want 4", count)
	}
}
