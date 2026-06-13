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
// ext_expr fields and annotations are stripped before marshalling — ext_expr is
// only used by the HCL emitter, and annotations are validator-only metadata;
// neither should appear in runtime output.
func EmitJSON(w io.Writer, tm *turnoutpb.TurnModel) diag.Diagnostics {
	if tm == nil {
		tm = &turnoutpb.TurnModel{}
	}
	tm = stripExtExpr(tm)
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

// stripExtExpr returns a deep-cloned TurnModel with all BindingModel.ExtExpr
// fields and the Annotations field set to nil. The runtime ignores ext_expr
// (only the HCL emitter uses it) and Annotations are validator-only metadata.
func stripExtExpr(tm *turnoutpb.TurnModel) *turnoutpb.TurnModel {
	clone := proto.Clone(tm).(*turnoutpb.TurnModel)
	clone.Annotations = nil
	for _, scene := range clone.Scenes {
		for _, action := range scene.Actions {
			stripProgExtExpr(action.GetCompute().GetProg())
			for _, nr := range action.Next {
				stripProgExtExpr(nr.GetCompute().GetProg())
			}
		}
	}
	return clone
}

func stripProgExtExpr(prog *turnoutpb.ProgModel) {
	if prog == nil {
		return
	}
	prog.Sigils = nil
	for _, b := range prog.Bindings {
		b.ExtExpr = nil
		b.SourcePos = nil
	}
}
