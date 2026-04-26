package parser_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

// ── ParseStateFile ─────────────────────────────────────────────────────────────

func TestParseStateFileValid(t *testing.T) {
	src := `state {
  ns {
    score:number = 0
    active:bool  = false
  }
}`
	sb, ds := parser.ParseStateFile("schema.turn", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected errors: %v", ds)
	}
	if sb == nil {
		t.Fatal("expected non-nil InlineStateBlock")
	}
	if len(sb.Namespaces) != 1 || sb.Namespaces[0].Name != "ns" {
		t.Errorf("namespace: got %v", sb.Namespaces)
	}
}

func TestParseStateFileNoStateBlock(t *testing.T) {
	// A file with no state block → error
	_, ds := parser.ParseStateFile("empty.turn", "")
	if !ds.HasErrors() {
		t.Error("expected error for state file with no state block")
	}
}

func TestParseStateFileWithStateFileDirective(t *testing.T) {
	// state_file directive instead of literal block → error
	src := `state_file = "other.turn"`
	_, ds := parser.ParseStateFile("bad.turn", src)
	if !ds.HasErrors() {
		t.Error("expected error when state file contains state_file directive")
	}
}

func TestParseStateFileLexError(t *testing.T) {
	// Invalid token causes lex error → ParseStateFile returns error
	_, ds := parser.ParseStateFile("bad.turn", `"unterminated`)
	if !ds.HasErrors() {
		t.Error("expected error for lex error in state file")
	}
}

// ── Keyword as reference value ─────────────────────────────────────────────────

func TestParseRefValKeyword(t *testing.T) {
	// Using "condition" (a keyword) as a reference value exercises the
	// isKeyword branch in parseRefVal.
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = condition
      prog "p" {
        v:bool = true
      }
    }
  }`)
	tf, ds := parser.ParseFile("test.turn", src)
	// Parser should succeed (no syntax errors); semantic errors (root not found) are OK.
	if ds.HasErrors() {
		t.Fatalf("unexpected parse errors: %v", ds)
	}
	if tf.Scenes[0].Actions[0].Compute.Root != "condition" {
		t.Errorf("root = %q, want %q", tf.Scenes[0].Actions[0].Compute.Root, "condition")
	}
}

func TestParseRefValKeywordDottedPath(t *testing.T) {
	// from_state = state.score: "state" is TokKwState, exercises keyword path + dot continuation.
	// The state block uses a valid namespace "ns"; the from_state path uses "state" as a keyword-ident.
	src := `state {
  ns {
    score:number = 0
  }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        ~>v:number
      }
    }
    prepare {
      v { from_state = state.score }
    }
  }
}`
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected parse errors: %v", ds)
	}
	prep := tf.Scenes[0].Actions[0].Prepare
	if prep == nil || len(prep.Entries) == 0 {
		t.Fatal("expected prepare entry")
	}
	fs, ok := prep.Entries[0].Source.(*ast.FromState)
	if !ok || fs.Path != "state.score" {
		t.Errorf("from_state = %v", prep.Entries[0].Source)
	}
}

// ── parseFieldType default case ────────────────────────────────────────────────

func TestParseFieldTypeError(t *testing.T) {
	// A number literal where a type is expected → parse error
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        v:42 = true
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── parseLiteral with heredoc / triple-quote ────────────────────────────────────

func TestParseLiteralHeredocInStateDef(t *testing.T) {
	// Heredoc as a state field default (exercises parseLiteral TokHeredoc branch)
	src := `state {
  ns {
    description:str = <<-EOT
      hello world
    EOT
  }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	tf := mustParse(t, src)
	ib := tf.StateSource.(*ast.InlineStateBlock)
	f := ib.Namespaces[0].Fields[0]
	sl, ok := f.Default.(*ast.StringLiteral)
	if !ok || sl.Value == "" {
		t.Errorf("heredoc default: got %T %v", f.Default, f.Default)
	}
}

func TestParseLiteralTripleQuoteInProg(t *testing.T) {
	// Triple-quoted string as binding RHS (exercises parseLiteral TokTripleQuote branch)
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        greeting:str = """
Hello world.
"""
        v:bool = true
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	if len(bindings) < 1 {
		t.Fatal("no bindings")
	}
	rhs, ok := bindings[0].RHS.(*ast.LiteralRHS)
	if !ok {
		t.Fatalf("expected LiteralRHS, got %T", bindings[0].RHS)
	}
	sl, ok := rhs.Value.(*ast.StringLiteral)
	if !ok || sl.Value == "" {
		t.Errorf("triple-quote: got %T %q", rhs.Value, sl)
	}
}

// ── parseBlockArg branches ─────────────────────────────────────────────────────

func TestParseBlockArgFuncRef(t *testing.T) {
	// { func_ref = "fn1" } as a function argument exercises the func_ref parsing branch.
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        v:number = 3
        fn1:number = add(v, v)
        result:number = add({ func_ref = "fn1" }, v)
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	fc, ok := bindings[2].RHS.(*ast.FuncCallRHS)
	if !ok {
		t.Fatalf("expected FuncCallRHS, got %T", bindings[2].RHS)
	}
	arg, ok := fc.Args[0].(*ast.FuncRefArg)
	if !ok {
		t.Fatalf("expected FuncRefArg, got %T", fc.Args[0])
	}
	if arg.FnName != "fn1" {
		t.Errorf("FnName = %q, want fn1", arg.FnName)
	}
}

func TestParseBlockArgTransform(t *testing.T) {
	// { transform = { ref = "v" fn = "to_str" } } exercises the transform branch
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        v:number = 3
        result:number = add({ transform = { ref = "v" fn = "myFn" } }, v)
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	fc, ok := bindings[1].RHS.(*ast.FuncCallRHS)
	if !ok {
		t.Fatalf("expected FuncCallRHS, got %T", bindings[1].RHS)
	}
	tr, ok := fc.Args[0].(*ast.TransformArg)
	if !ok {
		t.Fatalf("expected TransformArg, got %T", fc.Args[0])
	}
	if tr.Ref != "v" || len(tr.Fn) != 1 || tr.Fn[0] != "myFn" {
		t.Errorf("transform: ref=%q fn=%v", tr.Ref, tr.Fn)
	}
}

func TestParseBlockArgUnknownKey(t *testing.T) {
	// { bogus = x } exercises the default/unknown key branch → parse error
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        v:number = 3
        result:number = add({ bogus = v }, v)
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── parsePipeCompatRHS (block form { pipe = { ... } }) ─────────────────────────

func TestParsePipeCompatRHS(t *testing.T) {
	// New #pipe(initial, step1, ...) form: #pipe(x, add(#it, x))
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 5
        result:number = #pipe(x, add(#it, x))
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	pipe, ok := bindings[1].RHS.(*ast.PipeCallRHS)
	if !ok {
		t.Fatalf("expected PipeCallRHS, got %T", bindings[1].RHS)
	}
	initRef, ok := pipe.Initial.(*ast.LocalRefExpr)
	if !ok || initRef.Name != "x" {
		t.Errorf("initial: got %T, want ref to x", pipe.Initial)
	}
	if len(pipe.Steps) != 1 {
		t.Errorf("step count = %d, want 1", len(pipe.Steps))
	}
	call, ok := pipe.Steps[0].(*ast.LocalCallExpr)
	if !ok || call.FnAlias != "add" {
		t.Errorf("step[0]: got %T, want LocalCallExpr{add}", pipe.Steps[0])
	}
}

// ── parseIfCompatRHS (block form { if = { ... } }) ─────────────────────────────

func TestParseIfCompatRHS(t *testing.T) {
	// New #if(cond, then, else) call form
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool     = true
        thenFn:number = 1
        elseFn:number = 2
        result:number = #if(flag, thenFn, elseFn)
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	ifRHS, ok := bindings[3].RHS.(*ast.IfCallRHS)
	if !ok {
		t.Fatalf("expected IfCallRHS, got %T", bindings[3].RHS)
	}
	ref, ok := ifRHS.Cond.(*ast.LocalRefExpr)
	if !ok || ref.Name != "flag" {
		t.Errorf("cond: got %T", ifRHS.Cond)
	}
	thenRef, ok := ifRHS.Then.(*ast.LocalRefExpr)
	if !ok || thenRef.Name != "thenFn" {
		t.Errorf("then: got %T", ifRHS.Then)
	}
	elseRef, ok := ifRHS.Else.(*ast.LocalRefExpr)
	if !ok || elseRef.Name != "elseFn" {
		t.Errorf("else: got %T", ifRHS.Else)
	}
}

// ── parseRHS default (unexpected token) ────────────────────────────────────────

func TestParseRHSUnexpectedToken(t *testing.T) {
	// A closing brace where an RHS is expected → parse error
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        v:bool = }
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── skipBlock ─────────────────────────────────────────────────────────────────

func TestSkipBlockOnNamespaceError(t *testing.T) {
	// A state namespace block with a syntax error triggers skipBlock recovery.
	src := `state {
  ns {
    42 = bad
  }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	// Parser may recover or fail — we just check it doesn't panic.
	parser.ParseFile("test.turn", src) //nolint
}

// ── parseBindingDecl error recovery ───────────────────────────────────────────

func TestParseBindingDeclNameError(t *testing.T) {
	// Non-ident where binding name is expected → error + recovery
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        42:bool = true
        v:bool  = true
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── parseBlockRHS identifier error ────────────────────────────────────────────

func TestParseBlockRHSNonIdentKey(t *testing.T) {
	// Non-ident as block RHS key → parse error
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        v:bool = { 42 = x }
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── parseFnCompatRHS (fn_alias = [...]) ────────────────────────────────────────

func TestParseFnCompatRHS(t *testing.T) {
	// Function call form: add(x, y)
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 3
        y:number      = 4
        result:number = add(x, y)
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	fc, ok := bindings[2].RHS.(*ast.FuncCallRHS)
	if !ok {
		t.Fatalf("expected FuncCallRHS, got %T", bindings[2].RHS)
	}
	if fc.FnAlias != "add" {
		t.Errorf("fn = %q, want add", fc.FnAlias)
	}
	if len(fc.Args) != 2 {
		t.Errorf("args = %d, want 2", len(fc.Args))
	}
}

// ── All infix operators ────────────────────────────────────────────────────────

func TestParseAllInfixOperators(t *testing.T) {
	type tc struct {
		op   string
		want ast.InfixOp
	}
	cases := []tc{
		{"&", ast.InfixAnd},
		{">=", ast.InfixGTE},
		{"<=", ast.InfixLTE},
		{">", ast.InfixGT},
		{"<", ast.InfixLT},
		{"|", ast.InfixBoolOr},
		{"==", ast.InfixEq},
		{"!=", ast.InfixNeq},
		{"+", ast.InfixPlus},
		{"-", ast.InfixSub},
		{"*", ast.InfixMul},
		{"/", ast.InfixDiv},
		{"%", ast.InfixMod},
	}
	for _, tc := range cases {
		src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        a:number = 1
        b:number = 2
        v:number = a ` + tc.op + ` b
      }
    }
  }`)
		// For bool operators, adjust types
		if tc.op == "&" || tc.op == "|" {
			src = minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        a:bool = true
        b:bool = false
        v:bool = a ` + tc.op + ` b
      }
    }
  }`)
		}
		tf, ds := parser.ParseFile("test.turn", src)
		if ds.HasErrors() {
			t.Errorf("op %q: unexpected parse errors: %v", tc.op, ds)
			continue
		}
		bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
		infix, ok := bindings[2].RHS.(*ast.InfixRHS)
		if !ok {
			t.Errorf("op %q: expected InfixRHS, got %T", tc.op, bindings[2].RHS)
			continue
		}
		if infix.Op != tc.want {
			t.Errorf("op %q: got InfixOp %d, want %d", tc.op, infix.Op, tc.want)
		}
	}
}

// ── Next prepare with various sources ─────────────────────────────────────────

func TestParseNextPrepareFromState(t *testing.T) {
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          ~>x:number
          go:bool = true
        }
      }
      prepare {
        x { from_state = app.score }
      }
      action = b
    }
  }
  action "b" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	tf := mustParse(t, src)
	nr := tf.Scenes[0].Actions[0].Next[0]
	if nr.Prepare == nil || len(nr.Prepare.Entries) == 0 {
		t.Fatal("expected next prepare entries")
	}
	e := nr.Prepare.Entries[0]
	fs, ok := e.Source.(*ast.FromState)
	if !ok || fs.Path != "app.score" {
		t.Errorf("from_state = %v", e.Source)
	}
}

func TestParseNextPrepareFromLiteral(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          ~>x:number
          go:bool = true
        }
      }
      prepare {
        x { from_literal = 42 }
      }
      action = b
    }
  }
  action "b" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	tf := mustParse(t, src)
	nr := tf.Scenes[0].Actions[0].Next[0]
	if nr.Prepare == nil || len(nr.Prepare.Entries) == 0 {
		t.Fatal("expected next prepare entries")
	}
	e := nr.Prepare.Entries[0]
	fl, ok := e.Source.(*ast.FromLiteral)
	if !ok {
		t.Fatalf("expected FromLiteral, got %T", e.Source)
	}
	num, ok := fl.Value.(*ast.NumberLiteral)
	if !ok || num.Value != 42 {
		t.Errorf("from_literal value: got %T %v", fl.Value, fl.Value)
	}
}

// ── Integration: parse example files ──────────────────────────────────────────

func TestParseFromFileExample(t *testing.T) {
	data, err := os.ReadFile("../../../../../spec/examples/scene-graph-with-actions.turn")
	if err != nil {
		t.Skip("example file not found")
	}
	src := string(data)
	// Prepend a minimal state block if the file lacks one, so ParseFile succeeds.
	if !strings.Contains(src, "state {") && !strings.Contains(src, "state_file") {
		src = "state {}\n" + src
	}
	_, ds := parser.ParseFile("example.turn", src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("parse error: %s", d.Format())
		}
	}
}

// ── ParseStateFile with real file path ───────────────────────────────────────

func TestParseStateFileFromTemp(t *testing.T) {
	dir := t.TempDir()
	content := `state {
  schema {
    value:str = "default"
  }
}`
	path := filepath.Join(dir, "schema.turn")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	data, _ := os.ReadFile(path)
	sb, ds := parser.ParseStateFile(path, string(data))
	if ds.HasErrors() {
		t.Fatalf("errors: %v", ds)
	}
	if sb == nil || len(sb.Namespaces) != 1 {
		t.Errorf("expected 1 namespace, got %v", sb)
	}
}

// ── Lines 17-19: ParseFile lex error ─────────────────────────────────────────

func TestParseFileLexError(t *testing.T) {
	_, ds := parser.ParseFile("bad.turn", `"unterminated`)
	if !ds.HasErrors() {
		t.Error("expected lex error")
	}
}

// ── Lines 165-167: parseRefVal dot then non-ident ─────────────────────────────

func TestParseRefValDotNonIdent(t *testing.T) {
	// from_state = app.42 — dot followed by number literal instead of ident
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    prepare {
      v { from_state = app.42 }
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — just verify no panic
}

// ── Lines 193-194: parseRefVal default: number as ref value ───────────────────

func TestParseRefValNumberLiteral(t *testing.T) {
	// root = 42 — number literal where an ident ref is expected
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = 42
      prog "p" {
        v:bool = true
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 213-216: parseFieldType TokType invalid array element type ──────────

func TestParseFieldTypeInvalidArrayType(t *testing.T) {
	// v:arr<invalid_element_type> — TokType but FieldTypeFromString fails
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        v:arr<invalid_element_type> = []
        r:bool = true
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 220-223: parseFieldType TokIdent unknown type name ─────────────────

func TestParseFieldTypeUnknownIdent(t *testing.T) {
	// v:badtype — identifier that is not a valid type name
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        v:badtype = true
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 310-315: parseBlockArg non-ident key ────────────────────────────────

func TestParseBlockArgNonIdentKey(t *testing.T) {
	// { 42 = v } — number literal as key inside block arg
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        v:number = 3
        result:number = add({ 42 = v }, v)
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 333-335: transform body non-ident token ────────────────────────────

func TestParseTransformBodyNonIdent(t *testing.T) {
	// { transform = { 42 = x fn = "f" } } — number inside transform body
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        v:number = 3
        result:number = add({ transform = { 42 = x fn = "f" } }, v)
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 345-347: transform body unknown field ───────────────────────────────

func TestParseTransformBodyUnknownField(t *testing.T) {
	// { transform = { ref = "v" unknown_key = "x" fn = "f" } }
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        v:number = 3
        result:number = add({ transform = { ref = "v" unknown_key = "x" fn = "myFn" } }, v)
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 534-537: cond block unknown field ───────────────────────────────────

func TestParseCondBlockUnknownField(t *testing.T) {
	// { cond = { unknown_key = x then = tf else = ef } }
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        tf:number = 1
        ef:number = 2
        flag:bool = true
        result:number = { cond = { unknown_key = flag then = tf else = ef } }
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 538-540: cond block non-ident token ────────────────────────────────

func TestParseCondBlockNonIdentToken(t *testing.T) {
	// { cond = { 42 then = tf else = ef } } — number inside cond block
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        tf:number = 1
        ef:number = 2
        flag:bool = true
        result:number = { cond = { 42 then = tf else = ef } }
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 546-548: cond block no condExpr (nil → CondExprRef fallback) ────────

func TestParseCondBlockNoCond(t *testing.T) {
	// { cond = { then = tf else = ef } } — no condition field, should use CondExprRef{}
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        tf:number = 1
        ef:number = 2
        result:number = { cond = { then = tf else = ef } }
      }
    }
  }`)
	// Parser should recover (condExpr set to fallback), may or may not produce errors
	parser.ParseFile("test.turn", src) //nolint
}

// ── Lines 573-576: parsePipeCompatRHS non-ident field name ───────────────────

func TestParsePipeCompatRHSNonIdentField(t *testing.T) {
	// { pipe = { 42 = bad args = {} steps = [...] } } — number as field name in pipe block
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 5
        result:number = { pipe = { 42 = bad args = { a = x } steps = [add(a, a)] } }
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 584-585: parsePipeCompatRHS unknown field ──────────────────────────

func TestParsePipeCompatRHSUnknownField(t *testing.T) {
	// { pipe = { args = { a = x } steps = [...] unknown_field = x } }
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 5
        result:number = { pipe = { args = { a = x } steps = [add(a, a)] unknown_field = x } }
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 612-615: parseCompatArgList named key ───────────────────────────────

func TestParseCompatArgListNamedKeys(t *testing.T) {
	// Function call with two ref args: add(x, y)
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 3
        y:number      = 4
        result:number = add(x, y)
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	fc, ok := bindings[2].RHS.(*ast.FuncCallRHS)
	if !ok {
		t.Fatalf("expected FuncCallRHS, got %T", bindings[2].RHS)
	}
	if fc.FnAlias != "add" {
		t.Errorf("fn = %q, want add", fc.FnAlias)
	}
	if len(fc.Args) != 2 {
		t.Errorf("args = %d, want 2", len(fc.Args))
	}
}

// ── Lines 661-666: parsePipeStepsList non-ident function name ────────────────

func TestParsePipeStepsListNonIdentFn(t *testing.T) {
	// #pipe(a:x)[42(a, a), add(a, a)] — number literal as function name in pipe steps
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 5
        result:number = #pipe(a:x)[42(a, a), add(a, a)]
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 686-688: parsePipeArgsBlock non-ident param name ───────────────────

func TestParsePipeArgsBlockNonIdentParam(t *testing.T) {
	// { pipe = { args = { 42 = x } steps = [...] } } — number as param name
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 5
        result:number = { pipe = { args = { 42 = x } steps = [add(a, a)] } }
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 723-726: parseIfBody non-ident token ───────────────────────────────

func TestParseIfBodyNonIdentToken(t *testing.T) {
	// v:bool = #if { 42 cond = flag then = tf else = ef } — number inside #if block
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool   = true
        tf:number   = 1
        ef:number   = 2
        result:bool = #if { 42 cond = flag then = tf else = ef }
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 737-739: parseIfBody unknown field ─────────────────────────────────

func TestParseIfBodyUnknownField(t *testing.T) {
	// v:bool = #if { unknown_key = x cond = flag then = tf else = ef }
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool   = true
        tf:number   = 1
        ef:number   = 2
        result:bool = #if { unknown_key = flag cond = flag then = tf else = ef }
      }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 741-743: parseIfBody cond == nil (CondExprRef fallback) ─────────────

func TestParseIfBodyNoCond(t *testing.T) {
	// v:bool = #if { then = tf else = ef } — no cond field, uses CondExprRef{} fallback
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        tf:number   = 1
        ef:number   = 2
        result:bool = #if { then = tf else = ef }
      }
    }
  }`)
	tf, _ := parser.ParseFile("test.turn", src)
	if tf == nil {
		return // parse error is fine, just check no panic
	}
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	ifRHS, ok := bindings[2].RHS.(*ast.IfRHS)
	if !ok {
		t.Fatalf("expected IfRHS, got %T", bindings[2].RHS)
	}
	if _, ok := ifRHS.Cond.(*ast.CondExprRef); !ok {
		t.Errorf("expected CondExprRef fallback, got %T", ifRHS.Cond)
	}
}

// ── Lines 751-754: parseCondExpr non-ident ───────────────────────────────────

func TestParseCondExprNonIdent(t *testing.T) {
	// v:bool = #if { cond = 42 then = tf else = ef } — number as condition expression
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        tf:number   = 1
        ef:number   = 2
        result:bool = #if { cond = 42 then = tf else = ef }
      }
    }
  }`)
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 850-852: parseComputeBlock unexpected token ────────────────────────

func TestParseComputeBlockUnexpectedToken(t *testing.T) {
	// compute { unknown_field = v prog "p" { ... } }
	src := minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      unknown_field = v
      root = r
      prog "p" { r:bool = true }
    }
  }`)
	mustParseFail(t, src)
}

// ── Lines 869-872: parsePrepareBlock non-ident binding name ──────────────────

func TestParsePrepareBlockNonIdentName(t *testing.T) {
	// prepare { 42 { from_state = app.score } v { from_state = app.score } }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    prepare {
      42 { from_state = app.score }
      v { from_state = app.score }
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 891-895: parsePrepareBlock from_literal ────────────────────────────

func TestParsePrepareBlockFromLiteral(t *testing.T) {
	// prepare { x { from_literal = 42 } } — from_literal in action-level prepare
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    prepare {
      v { from_literal = 42 }
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — parser accepts, validator may reject
}

// ── Lines 896-899: parsePrepareBlock unexpected token in entry ────────────────

func TestParsePrepareBlockUnknownField(t *testing.T) {
	// prepare { x { unknown_field = v from_state = app.score } }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    prepare {
      v { unknown_field = bad from_state = app.score }
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 903-906: parsePrepareBlock no source (empty entry body) ─────────────

func TestParsePrepareBlockNoSource(t *testing.T) {
	// prepare { x { } } — prepare entry with no from_* source
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    prepare {
      v { }
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 927-930: parseMergeBlock non-ident binding name ────────────────────

func TestParseMergeBlockNonIdentName(t *testing.T) {
	// merge { 42 { to_state = app.score } x { to_state = app.score } }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    merge {
      42 { to_state = app.score }
      v { to_state = app.score }
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 943-946: parseMergeBlock unexpected token in merge entry ────────────

func TestParseMergeBlockUnknownField(t *testing.T) {
	// merge { x { unknown = v to_state = app.score } }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    merge {
      v { unknown = bad to_state = app.score }
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 975-978: parsePublishBlock unexpected token ────────────────────────

func TestParsePublishBlockUnexpectedToken(t *testing.T) {
	// publish { unknown = "x" hook = "h" }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    publish { unknown = "x" hook = "h" }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1006-1009: parseNextBlock unexpected token ─────────────────────────

func TestParseNextBlockUnexpectedToken(t *testing.T) {
	// next { unknown_token = x action = a }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      unknown_token = bad
      compute { condition = go prog "n" { go:bool = true } }
      action = a
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1032-1035: parseNextComputeBlock unexpected token ──────────────────

func TestParseNextComputeBlockUnexpectedToken(t *testing.T) {
	// next { compute { unknown = x condition = go prog "n" { ... } } action = a }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute {
        unknown = bad
        condition = go
        prog "n" { go:bool = true }
      }
      action = a
    }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1049-1052: parseNextPrepareBlock non-ident binding name ─────────────

func TestParseNextPrepareBlockNonIdentName(t *testing.T) {
	// next { prepare { 42 { from_action = r } x { from_action = r } } action = a }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute { condition = go prog "n" { ~>x:number = _ go:bool = true } }
      prepare {
        42 { from_action = v }
        x { from_action = v }
      }
      action = b
    }
  }
  action "b" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1074-1076: parseNextPrepareBlock unknown token in entry ─────────────

func TestParseNextPrepareBlockUnknownField(t *testing.T) {
	// next { prepare { x { unknown = v from_action = r } } action = a }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute { condition = go prog "n" { ~>x:number = _ go:bool = true } }
      prepare {
        x { unknown = bad from_action = v }
      }
      action = b
    }
  }
  action "b" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1081-1084: parseNextPrepareBlock no source ─────────────────────────

func TestParseNextPrepareBlockNoSource(t *testing.T) {
	// next { prepare { x { } } action = a }
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute { condition = go prog "n" { ~>x:number = _ go:bool = true } }
      prepare {
        x { }
      }
      action = b
    }
  }
  action "b" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1112-1116: parseActionBlock duplicate triple-quoted text ────────────

func TestParseActionBlockDuplicateTripleQuote(t *testing.T) {
	// action "a" { """first""" """second""" compute { ... } }
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    """first text"""
    """second text"""
    compute { root = r prog "p" { r:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1124-1126: parseActionBlock text = with non-string value ────────────

func TestParseActionBlockTextNonString(t *testing.T) {
	// action "a" { text = 42 compute { ... } }
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    text = 42
    compute { root = r prog "p" { r:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1127-1131: parseActionBlock duplicate text = ───────────────────────

func TestParseActionBlockDuplicateText(t *testing.T) {
	// action "a" { text = "first" text = "second" compute { ... } }
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    text = "first"
    text = "second"
    compute { root = r prog "p" { r:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1142-1145: parseActionBlock unexpected token ───────────────────────

func TestParseActionBlockUnexpectedToken(t *testing.T) {
	// action "a" { unknown_field = x compute { ... } }
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    unknown_field = bad
    compute { root = r prog "p" { r:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1170-1172: parseViewBlock flow with non-string value ───────────────

func TestParseViewBlockFlowNonString(t *testing.T) {
	// view "v" { flow = 42 }
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  view "v" {
    flow = 42
  }
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1178-1181: parseViewBlock unexpected token ─────────────────────────

func TestParseViewBlockUnexpectedToken(t *testing.T) {
	// view "v" { unknown = x flow = "abc" }
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  view "v" {
    unknown = bad
    flow = "abc"
  }
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1213-1216: parseSceneBlock unexpected token ────────────────────────

func TestParseSceneBlockUnexpectedToken(t *testing.T) {
	// scene "s" { 42 = bad entry_actions = ["a"] action "a" { ... } }
	src := `state { ns { v:number = 0 } }
scene "test" {
  42 = bad
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1251-1254: parseInlineStateBlock non-ident namespace ───────────────

func TestParseInlineStateBlockNonIdentNamespace(t *testing.T) {
	// state { 42 { score:number = 0 } app { x:number = 0 } }
	src := `state {
  42 { score:number = 0 }
  app { x:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1312-1315: parseRouteBlock unknown token ────────────────────────────

func TestParseRouteBlockUnexpectedToken(t *testing.T) {
	// route "r1" { unknown = x match { ... } }
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}
route "r1" {
  unknown = bad
  match {
    test => test
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1380-1383: parsePathExpr invalid first token ───────────────────────

func TestParsePathExprInvalidFirstToken(t *testing.T) {
	// route "r1" { match { 42 => s } } — number as scene_id in path
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}
route "r1" {
  match {
    42 => test
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1396-1402: parsePathExpr dot followed by invalid segment ────────────

func TestParsePathExprDotInvalidSegment(t *testing.T) {
	// A path like "scene.42" — dot followed by number
	src := `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}
route "r1" {
  match {
    test.42 => test
  }
}`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}

// ── Lines 1462-1463: parseFile unexpected ident at top level ─────────────────

func TestParseFileUnexpectedTopLevelIdent(t *testing.T) {
	// someident = 1 at top level (not state/scene/route)
	src := `state { app { x:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}
someident = 1`
	parser.ParseFile("test.turn", src) //nolint — error recovery test
}
