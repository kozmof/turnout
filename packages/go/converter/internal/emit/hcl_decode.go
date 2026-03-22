package emit

import (
	"context"
	"fmt"

	"github.com/hashicorp/hcl-lang/decoder"
	"github.com/hashicorp/hcl-lang/lang"
	"github.com/hashicorp/hcl-lang/validator"
	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/turnout/converter/internal/emit/turnoutpb"
	"github.com/zclconf/go-cty/cty"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// hcl-lang path reader — minimal implementation for Validate
// ─────────────────────────────────────────────────────────────────────────────

const hclFilename = "turnout.hcl"

type singlePathReader struct {
	file *hcl.File
}

func (r *singlePathReader) Paths(_ context.Context) []lang.Path {
	return []lang.Path{{}}
}

func (r *singlePathReader) PathContext(_ lang.Path) (*decoder.PathContext, error) {
	return &decoder.PathContext{
		Schema: turnoutBodySchema(),
		Files:  map[string]*hcl.File{hclFilename: r.file},
		Validators: []validator.Validator{
			validator.UnexpectedAttribute{},
			validator.UnexpectedBlock{},
			validator.MissingRequiredAttribute{},
			validator.BlockLabelsLength{},
			validator.MaxBlocks{},
		},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// validateHCL: parse + hcl-lang schema validation
// ─────────────────────────────────────────────────────────────────────────────

// validateHCL parses src and validates it against the canonical turnout HCL
// schema using hcl-lang. Returns the parsed file (for decoding) and any
// diagnostics from parsing or schema validation.
func validateHCL(src []byte) (*hcl.File, hcl.Diagnostics) {
	f, diags := hclsyntax.ParseConfig(src, hclFilename, hcl.InitialPos)
	if diags.HasErrors() {
		return nil, diags
	}

	pr := &singlePathReader{file: f}
	d := decoder.NewDecoder(pr)
	pd, err := d.Path(lang.Path{})
	if err != nil {
		return f, append(diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "hcl-lang path error",
			Detail:   err.Error(),
		})
	}

	valDiags, err := pd.ValidateFile(context.Background(), hclFilename)
	if err != nil {
		return f, append(diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "hcl-lang validate error",
			Detail:   err.Error(),
		})
	}
	return f, append(diags, valDiags...)
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level body → TurnModel
// ─────────────────────────────────────────────────────────────────────────────

// decodeHCLBody converts a parsed and validated HCL body into a TurnModel
// proto ready for JSON marshalling. This is the source for JSON output:
// DSL → lower.Model → HCL text → validateHCL → decodeHCLBody → JSON.
func decodeHCLBody(body hcl.Body) (*turnoutpb.TurnModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "state"},
			{Type: "scene", LabelNames: []string{"id"}},
			{Type: "route", LabelNames: []string{"id"}},
		},
	})
	if diags.HasErrors() {
		return nil, diags
	}

	tm := &turnoutpb.TurnModel{}
	for _, block := range content.Blocks {
		switch block.Type {
		case "state":
			s, d := decodeStateBlock(block.Body)
			diags = append(diags, d...)
			if !d.HasErrors() {
				tm.State = s
			}
		case "scene":
			s, d := decodeSceneBlock(block.Labels[0], block.Body)
			diags = append(diags, d...)
			if !d.HasErrors() {
				tm.Scenes = append(tm.Scenes, s)
			}
		case "route":
			r, d := decodeRouteBlock(block.Labels[0], block.Body)
			diags = append(diags, d...)
			if !d.HasErrors() {
				tm.Routes = append(tm.Routes, r)
			}
		}
	}
	return tm, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

func decodeStateBlock(body hcl.Body) (*turnoutpb.StateModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "namespace", LabelNames: []string{"name"}},
		},
	})
	sm := &turnoutpb.StateModel{}
	for _, block := range content.Blocks {
		ns, d := decodeNamespaceBlock(block.Labels[0], block.Body)
		diags = append(diags, d...)
		if !d.HasErrors() {
			sm.Namespaces = append(sm.Namespaces, ns)
		}
	}
	return sm, diags
}

func decodeNamespaceBlock(name string, body hcl.Body) (*turnoutpb.NamespaceModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "field", LabelNames: []string{"name"}},
		},
	})
	nm := &turnoutpb.NamespaceModel{Name: name}
	for _, block := range content.Blocks {
		f, d := decodeFieldBlock(block.Labels[0], block.Body)
		diags = append(diags, d...)
		if !d.HasErrors() {
			nm.Fields = append(nm.Fields, f)
		}
	}
	return nm, diags
}

func decodeFieldBlock(name string, body hcl.Body) (*turnoutpb.FieldModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "type", Required: true},
			{Name: "value", Required: true},
		},
	})
	fm := &turnoutpb.FieldModel{Name: name}
	if attr, ok := content.Attributes["type"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if v.Type() == cty.String {
			fm.Type = v.AsString()
		}
	}
	if attr, ok := content.Attributes["value"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if !d.HasErrors() {
			fm.Value = ctyToStructpb(v)
		}
	}
	return fm, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────────────────────────────────────

func decodeSceneBlock(id string, body hcl.Body) (*turnoutpb.SceneBlock, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "entry_actions", Required: true},
			{Name: "next_policy", Required: false},
		},
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "action", LabelNames: []string{"id"}},
		},
	})
	sb := &turnoutpb.SceneBlock{Id: id}

	if attr, ok := content.Attributes["entry_actions"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if !d.HasErrors() {
			sb.EntryActions = ctyToStringSlice(v)
		}
	}
	if attr, ok := content.Attributes["next_policy"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if v.Type() == cty.String {
			sb.NextPolicy = proto.String(v.AsString())
		}
	}
	for _, block := range content.Blocks {
		a, d := decodeActionBlock(block.Labels[0], block.Body)
		diags = append(diags, d...)
		if !d.HasErrors() {
			sb.Actions = append(sb.Actions, a)
		}
	}
	return sb, diags
}

func decodeActionBlock(id string, body hcl.Body) (*turnoutpb.ActionModel, hcl.Diagnostics) {
	// text is a valid HCL attribute (human-readable doc) but is not carried into
	// JSON output, so we include it in the schema but discard the value.
	content, diags := body.Content(&hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "text", Required: false},
			{Name: "publish", Required: false},
		},
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "compute"},
			{Type: "prepare"},
			{Type: "merge"},
			{Type: "next"},
		},
	})
	am := &turnoutpb.ActionModel{Id: id}

	if attr, ok := content.Attributes["publish"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if !d.HasErrors() {
			am.Publish = ctyToStringSlice(v)
		}
	}
	for _, block := range content.Blocks {
		switch block.Type {
		case "compute":
			c, d := decodeActionComputeBlock(block.Body)
			diags = append(diags, d...)
			if !d.HasErrors() {
				am.Compute = c
			}
		case "prepare":
			entries, d := decodeActionPrepareBlock(block.Body)
			diags = append(diags, d...)
			am.Prepare = append(am.Prepare, entries...)
		case "merge":
			entries, d := decodeMergeBlock(block.Body)
			diags = append(diags, d...)
			am.Merge = append(am.Merge, entries...)
		case "next":
			nr, d := decodeNextBlock(block.Body)
			diags = append(diags, d...)
			if !d.HasErrors() {
				am.Next = append(am.Next, nr)
			}
		}
	}
	return am, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute / Prog / Binding
// ─────────────────────────────────────────────────────────────────────────────

func decodeActionComputeBlock(body hcl.Body) (*turnoutpb.ComputeModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "root", Required: true},
		},
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "prog", LabelNames: []string{"name"}},
		},
	})
	cm := &turnoutpb.ComputeModel{}
	if attr, ok := content.Attributes["root"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if v.Type() == cty.String {
			cm.Root = v.AsString()
		}
	}
	for _, block := range content.Blocks {
		p, d := decodeProgBlock(block.Labels[0], block.Body)
		diags = append(diags, d...)
		if !d.HasErrors() {
			cm.Prog = p
		}
		break // at most one prog per compute
	}
	return cm, diags
}

func decodeProgBlock(name string, body hcl.Body) (*turnoutpb.ProgModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "binding", LabelNames: []string{"name"}},
		},
	})
	pm := &turnoutpb.ProgModel{Name: name}
	for _, block := range content.Blocks {
		b, d := decodeBindingBlock(block.Labels[0], block.Body)
		diags = append(diags, d...)
		if !d.HasErrors() {
			pm.Bindings = append(pm.Bindings, b)
		}
	}
	return pm, diags
}

func decodeBindingBlock(name string, body hcl.Body) (*turnoutpb.BindingModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "type", Required: true},
			{Name: "value", Required: false},
			{Name: "expr", Required: false},
		},
	})
	bm := &turnoutpb.BindingModel{Name: name}
	if attr, ok := content.Attributes["type"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if v.Type() == cty.String {
			bm.Type = v.AsString()
		}
	}
	if attr, ok := content.Attributes["value"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if !d.HasErrors() {
			bm.Value = ctyToStructpb(v)
		}
	} else if attr, ok := content.Attributes["expr"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if !d.HasErrors() {
			em, ed := ctyToExprModel(v, attr.Range)
			diags = append(diags, ed...)
			if !ed.HasErrors() {
				bm.Expr = em
			}
		}
	}
	return bm, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// Expr (combine / pipe / cond) — decoded from cty object values
// ─────────────────────────────────────────────────────────────────────────────

// ctyToExprModel decodes `expr = { combine/pipe/cond = { ... } }` from the
// evaluated cty.Value of the `expr` attribute.
func ctyToExprModel(v cty.Value, rng hcl.Range) (*turnoutpb.ExprModel, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	if v.IsNull() || !v.IsKnown() {
		return nil, diags
	}
	em := &turnoutpb.ExprModel{}
	ty := v.Type()
	switch {
	case ty.HasAttribute("combine"):
		c, d := ctyToCombine(v.GetAttr("combine"), rng)
		diags = append(diags, d...)
		em.Combine = c
	case ty.HasAttribute("pipe"):
		p, d := ctyToPipe(v.GetAttr("pipe"), rng)
		diags = append(diags, d...)
		em.Pipe = p
	case ty.HasAttribute("cond"):
		c, d := ctyToCond(v.GetAttr("cond"), rng)
		diags = append(diags, d...)
		em.Cond = c
	default:
		diags = append(diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "invalid expr",
			Detail:   "expr must contain combine, pipe, or cond",
			Subject:  &rng,
		})
	}
	return em, diags
}

// ctyToCombine decodes `{ fn = "..." args = [...] }`.
func ctyToCombine(v cty.Value, rng hcl.Range) (*turnoutpb.CombineExpr, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	c := &turnoutpb.CombineExpr{}
	ty := v.Type()
	if ty.HasAttribute("fn") {
		fv := v.GetAttr("fn")
		if fv.Type() == cty.String {
			c.Fn = fv.AsString()
		}
	}
	if ty.HasAttribute("args") {
		args, d := ctyToArgSlice(v.GetAttr("args"), rng)
		diags = append(diags, d...)
		c.Args = args
	}
	return c, diags
}

// ctyToPipe decodes `{ args = { p = { ref = "v" } } steps = [...] }`.
func ctyToPipe(v cty.Value, rng hcl.Range) (*turnoutpb.PipeExpr, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	p := &turnoutpb.PipeExpr{}
	ty := v.Type()
	if ty.HasAttribute("args") {
		argsObj := v.GetAttr("args")
		if !argsObj.IsNull() && argsObj.IsKnown() && argsObj.Type().IsObjectType() {
			for paramName, ref := range argsObj.AsValueMap() {
				srcIdent := ""
				if ref.Type().HasAttribute("ref") {
					rv := ref.GetAttr("ref")
					if rv.Type() == cty.String {
						srcIdent = rv.AsString()
					}
				}
				p.Params = append(p.Params, &turnoutpb.PipeParam{
					ParamName:   paramName,
					SourceIdent: srcIdent,
				})
			}
		}
	}
	if ty.HasAttribute("steps") {
		stepsVal := v.GetAttr("steps")
		if !stepsVal.IsNull() && stepsVal.IsKnown() {
			it := stepsVal.ElementIterator()
			for it.Next() {
				_, stepVal := it.Element()
				step := &turnoutpb.PipeStep{}
				if stepVal.Type().HasAttribute("fn") {
					fv := stepVal.GetAttr("fn")
					if fv.Type() == cty.String {
						step.Fn = fv.AsString()
					}
				}
				if stepVal.Type().HasAttribute("args") {
					args, d := ctyToArgSlice(stepVal.GetAttr("args"), rng)
					diags = append(diags, d...)
					step.Args = args
				}
				p.Steps = append(p.Steps, step)
			}
		}
	}
	return p, diags
}

// ctyToCond decodes `{ condition = {...} then = {...} else = {...} }`.
func ctyToCond(v cty.Value, rng hcl.Range) (*turnoutpb.CondExpr, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	c := &turnoutpb.CondExpr{}
	ty := v.Type()
	if ty.HasAttribute("condition") {
		a, d := ctyToArg(v.GetAttr("condition"), rng)
		diags = append(diags, d...)
		c.Condition = a
	}
	if ty.HasAttribute("then") {
		a, d := ctyToArg(v.GetAttr("then"), rng)
		diags = append(diags, d...)
		c.Then = a
	}
	if ty.HasAttribute("else") {
		a, d := ctyToArg(v.GetAttr("else"), rng)
		diags = append(diags, d...)
		c.ElseBranch = a
	}
	return c, diags
}

// ctyToArgSlice decodes a tuple/list of arg objects `[{ ref = "x" }, ...]`.
func ctyToArgSlice(v cty.Value, rng hcl.Range) ([]*turnoutpb.ArgModel, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	if v.IsNull() || !v.IsKnown() {
		return nil, diags
	}
	var args []*turnoutpb.ArgModel
	it := v.ElementIterator()
	for it.Next() {
		_, elem := it.Element()
		a, d := ctyToArg(elem, rng)
		diags = append(diags, d...)
		if a != nil {
			args = append(args, a)
		}
	}
	return args, diags
}

// ctyToArg decodes a single arg object such as `{ ref = "x" }` or `{ lit = 5 }`.
func ctyToArg(v cty.Value, rng hcl.Range) (*turnoutpb.ArgModel, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	if v.IsNull() || !v.IsKnown() {
		return nil, diags
	}
	am := &turnoutpb.ArgModel{}
	ty := v.Type()
	switch {
	case ty.HasAttribute("ref"):
		rv := v.GetAttr("ref")
		if rv.Type() == cty.String {
			am.Ref = proto.String(rv.AsString())
		}
	case ty.HasAttribute("lit"):
		am.Lit = ctyToStructpb(v.GetAttr("lit"))
	case ty.HasAttribute("func_ref"):
		fv := v.GetAttr("func_ref")
		if fv.Type() == cty.String {
			am.FuncRef = proto.String(fv.AsString())
		}
	case ty.HasAttribute("step_ref"):
		sv := v.GetAttr("step_ref")
		if sv.Type() == cty.Number {
			bf := sv.AsBigFloat()
			i64, _ := bf.Int64()
			am.StepRef = proto.Int32(int32(i64))
		}
	case ty.HasAttribute("transform"):
		tv := v.GetAttr("transform")
		ta := &turnoutpb.TransformArg{}
		if tv.Type().HasAttribute("ref") {
			rv := tv.GetAttr("ref")
			if rv.Type() == cty.String {
				ta.Ref = rv.AsString()
			}
		}
		if tv.Type().HasAttribute("fn") {
			fv := tv.GetAttr("fn")
			if fv.Type() == cty.String {
				ta.Fn = fv.AsString()
			}
		}
		am.Transform = ta
	default:
		diags = append(diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "invalid arg",
			Detail:   fmt.Sprintf("arg object must have ref, lit, func_ref, step_ref, or transform; got type %s", ty.FriendlyName()),
			Subject:  &rng,
		})
	}
	return am, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge
// ─────────────────────────────────────────────────────────────────────────────

func decodeActionPrepareBlock(body hcl.Body) ([]*turnoutpb.PrepareEntry, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "binding", LabelNames: []string{"name"}},
		},
	})
	var entries []*turnoutpb.PrepareEntry
	for _, block := range content.Blocks {
		bc, d := block.Body.Content(&hcl.BodySchema{
			Attributes: []hcl.AttributeSchema{
				{Name: "from_state", Required: false},
				{Name: "from_hook", Required: false},
			},
		})
		diags = append(diags, d...)
		pe := &turnoutpb.PrepareEntry{Binding: block.Labels[0]}
		if attr, ok := bc.Attributes["from_state"]; ok {
			v, d2 := attr.Expr.Value(nil)
			diags = append(diags, d2...)
			if v.Type() == cty.String {
				pe.FromState = proto.String(v.AsString())
			}
		} else if attr, ok := bc.Attributes["from_hook"]; ok {
			v, d2 := attr.Expr.Value(nil)
			diags = append(diags, d2...)
			if v.Type() == cty.String {
				pe.FromHook = proto.String(v.AsString())
			}
		}
		entries = append(entries, pe)
	}
	return entries, diags
}

func decodeMergeBlock(body hcl.Body) ([]*turnoutpb.MergeEntry, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "binding", LabelNames: []string{"name"}},
		},
	})
	var entries []*turnoutpb.MergeEntry
	for _, block := range content.Blocks {
		bc, d := block.Body.Content(&hcl.BodySchema{
			Attributes: []hcl.AttributeSchema{
				{Name: "to_state", Required: true},
			},
		})
		diags = append(diags, d...)
		me := &turnoutpb.MergeEntry{Binding: block.Labels[0]}
		if attr, ok := bc.Attributes["to_state"]; ok {
			v, d2 := attr.Expr.Value(nil)
			diags = append(diags, d2...)
			if v.Type() == cty.String {
				me.ToState = v.AsString()
			}
		}
		entries = append(entries, me)
	}
	return entries, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule
// ─────────────────────────────────────────────────────────────────────────────

func decodeNextBlock(body hcl.Body) (*turnoutpb.NextRuleModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "action", Required: true},
		},
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "compute"},
			{Type: "prepare"},
		},
	})
	nr := &turnoutpb.NextRuleModel{}
	if attr, ok := content.Attributes["action"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if v.Type() == cty.String {
			nr.Action = v.AsString()
		}
	}
	for _, block := range content.Blocks {
		switch block.Type {
		case "compute":
			c, d := decodeNextComputeBlock(block.Body)
			diags = append(diags, d...)
			if !d.HasErrors() {
				nr.Compute = c
			}
		case "prepare":
			entries, d := decodeNextPrepareBlock(block.Body)
			diags = append(diags, d...)
			nr.Prepare = append(nr.Prepare, entries...)
		}
	}
	return nr, diags
}

func decodeNextComputeBlock(body hcl.Body) (*turnoutpb.NextComputeModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "condition", Required: true},
		},
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "prog", LabelNames: []string{"name"}},
		},
	})
	nc := &turnoutpb.NextComputeModel{}
	if attr, ok := content.Attributes["condition"]; ok {
		v, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if v.Type() == cty.String {
			nc.Condition = v.AsString()
		}
	}
	for _, block := range content.Blocks {
		p, d := decodeProgBlock(block.Labels[0], block.Body)
		diags = append(diags, d...)
		if !d.HasErrors() {
			nc.Prog = p
		}
		break
	}
	return nc, diags
}

// decodeNextPrepareBlock decodes the `prepare { ... }` block inside a `next`
// rule and returns the flat list of NextPrepareEntry values (matching the
// NextRuleModel.Prepare repeated field).
func decodeNextPrepareBlock(body hcl.Body) ([]*turnoutpb.NextPrepareEntry, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "binding", LabelNames: []string{"name"}},
		},
	})
	var entries []*turnoutpb.NextPrepareEntry
	for _, block := range content.Blocks {
		bc, d := block.Body.Content(&hcl.BodySchema{
			Attributes: []hcl.AttributeSchema{
				{Name: "from_action", Required: false},
				{Name: "from_state", Required: false},
				{Name: "from_literal", Required: false},
			},
		})
		diags = append(diags, d...)
		entry := &turnoutpb.NextPrepareEntry{Binding: block.Labels[0]}
		switch {
		case bc.Attributes["from_action"] != nil:
			v, d2 := bc.Attributes["from_action"].Expr.Value(nil)
			diags = append(diags, d2...)
			if v.Type() == cty.String {
				entry.FromAction = proto.String(v.AsString())
			}
		case bc.Attributes["from_state"] != nil:
			v, d2 := bc.Attributes["from_state"].Expr.Value(nil)
			diags = append(diags, d2...)
			if v.Type() == cty.String {
				entry.FromState = proto.String(v.AsString())
			}
		case bc.Attributes["from_literal"] != nil:
			v, d2 := bc.Attributes["from_literal"].Expr.Value(nil)
			diags = append(diags, d2...)
			if !d2.HasErrors() {
				entry.FromLiteral = ctyToStructpb(v)
			}
		}
		entries = append(entries, entry)
	}
	return entries, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

func decodeRouteBlock(id string, body hcl.Body) (*turnoutpb.RouteModel, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "match"},
		},
	})
	rm := &turnoutpb.RouteModel{Id: id}
	for _, block := range content.Blocks {
		arms, d := decodeMatchBlock(block.Body)
		diags = append(diags, d...)
		rm.Match = append(rm.Match, arms...)
	}
	return rm, diags
}

func decodeMatchBlock(body hcl.Body) ([]*turnoutpb.MatchArm, hcl.Diagnostics) {
	content, diags := body.Content(&hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "arm"},
		},
	})
	var arms []*turnoutpb.MatchArm
	for _, block := range content.Blocks {
		bc, d := block.Body.Content(&hcl.BodySchema{
			Attributes: []hcl.AttributeSchema{
				{Name: "patterns", Required: true},
				{Name: "target", Required: true},
			},
		})
		diags = append(diags, d...)
		arm := &turnoutpb.MatchArm{}
		if attr, ok := bc.Attributes["patterns"]; ok {
			v, d2 := attr.Expr.Value(nil)
			diags = append(diags, d2...)
			arm.Patterns = ctyToStringSlice(v)
		}
		if attr, ok := bc.Attributes["target"]; ok {
			v, d2 := attr.Expr.Value(nil)
			diags = append(diags, d2...)
			if v.Type() == cty.String {
				arm.Target = v.AsString()
			}
		}
		arms = append(arms, arm)
	}
	return arms, diags
}

// ─────────────────────────────────────────────────────────────────────────────
// cty helpers
// ─────────────────────────────────────────────────────────────────────────────

// ctyToStringSlice converts a cty list/tuple of strings to a []string.
func ctyToStringSlice(v cty.Value) []string {
	if v.IsNull() || !v.IsKnown() {
		return nil
	}
	var out []string
	it := v.ElementIterator()
	for it.Next() {
		_, elem := it.Element()
		if elem.Type() == cty.String {
			out = append(out, elem.AsString())
		}
	}
	return out
}

// ctyToStructpb converts a cty.Value to a structpb.Value for JSON serialisation.
func ctyToStructpb(v cty.Value) *structpb.Value {
	if v.IsNull() || !v.IsKnown() {
		return structpb.NewNullValue()
	}
	switch v.Type() {
	case cty.String:
		return structpb.NewStringValue(v.AsString())
	case cty.Bool:
		return structpb.NewBoolValue(v.True())
	case cty.Number:
		f, _ := v.AsBigFloat().Float64()
		return structpb.NewNumberValue(f)
	}
	if v.Type().IsListType() || v.Type().IsTupleType() || v.Type().IsSetType() {
		arr := []*structpb.Value{}
		it := v.ElementIterator()
		for it.Next() {
			_, elem := it.Element()
			arr = append(arr, ctyToStructpb(elem))
		}
		return structpb.NewListValue(&structpb.ListValue{Values: arr})
	}
	return structpb.NewNullValue()
}
