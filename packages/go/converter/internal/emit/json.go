package emit

import (
	"encoding/json"
	"io"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

//go:generate sh -c "PATH=\"$HOME/go/bin:$(go env GOPATH)/bin:$PATH\" buf generate ../../../../../"

// Model compatibility versions written into every emitted JSON file.
// Bump these when the proto schema or runtime contract changes so that the
// TypeScript runner's migrateModel() can detect mismatches at load time.
const (
	jsonModelVersion   = 1
	jsonMinVersion     = 1
	jsonMaxVersion     = 1
)

// EmitJSON marshals a validated proto model directly to indented JSON.
// Before marshalling, stripNonRuntimeFields clones the model and removes fields
// that are only meaningful to the compiler, not the runtime:
//   - ext_expr on each binding (HCL-emission representation; runtime uses expr)
//   - source_pos on each binding (diagnostics only)
//   - sigils on each prog (ingress/egress direction; resolved into prepare/merge entries)
//   - annotations on the model (validator-only metadata)
func EmitJSON(w io.Writer, tm *turnoutpb.TurnModel) diag.Diagnostics {
	if tm == nil {
		tm = &turnoutpb.TurnModel{}
	}
	tm = stripNonRuntimeFields(tm)
	tm.Version    = jsonModelVersion
	tm.MinVersion = jsonMinVersion
	tm.MaxVersion = jsonMaxVersion
	raw, err := protojson.Marshal(tm)
	if err != nil {
		return diag.Diagnostics{diag.Errorf(diag.CodeEmitIOError, "JSON emit failed: %v", err)}
	}
	var buf []byte
	if buf, err = json.MarshalIndent(json.RawMessage(raw), "", "  "); err != nil {
		return diag.Diagnostics{diag.Errorf(diag.CodeEmitIOError, "JSON emit failed: %v", err)}
	}
	buf = append(buf, '\n')
	if _, err = w.Write(buf); err != nil {
		return diag.Diagnostics{diag.Errorf(diag.CodeEmitIOError, "JSON emit failed: %v", err)}
	}
	return nil
}

// stripNonRuntimeFields returns a deep-cloned TurnModel with all compiler-only
// fields removed. Specifically:
//   - Annotations: validator-only metadata, never consumed by the runtime
//   - Per-binding ExtExpr: HCL re-emission form; the runtime uses Expr
//   - Per-binding SourcePos: file/line/col for diagnostics; unused at runtime
//   - Per-prog Sigils: ingress/egress direction annotations resolved into
//     prepare/merge entries during compilation; the runtime reads those instead
func stripNonRuntimeFields(tm *turnoutpb.TurnModel) *turnoutpb.TurnModel {
	clone := proto.Clone(tm).(*turnoutpb.TurnModel)
	clone.Annotations = nil
	for _, scene := range clone.Scenes {
		for _, action := range scene.Actions {
			stripProgNonRuntimeFields(action.GetCompute().GetProg())
			for _, nr := range action.Next {
				stripProgNonRuntimeFields(nr.GetCompute().GetProg())
			}
		}
	}
	return clone
}

func stripProgNonRuntimeFields(prog *turnoutpb.ProgModel) {
	if prog == nil {
		return
	}
	prog.Sigils = nil
	for _, b := range prog.Bindings {
		b.ExtExpr = nil
		b.SourcePos = nil
	}
}
