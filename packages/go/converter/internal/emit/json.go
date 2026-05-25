package emit

import (
	"encoding/json"
	"io"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

//go:generate sh -c "PATH=\"$HOME/go/bin:$(go env GOPATH)/bin:$PATH\" buf generate ../../../../../"

// EmitJSON marshals a validated proto model directly to indented JSON.
// ext_expr fields and annotations are stripped before marshalling — ext_expr is
// only used by the HCL emitter, and annotations are validator-only metadata;
// neither should appear in runtime output.
// version, min_version, and max_version are set to 1 to declare schema and
// runtime compatibility so the TypeScript runner can detect mismatches at load time.
func EmitJSON(w io.Writer, tm *turnoutpb.TurnModel) error {
	if tm == nil {
		tm = &turnoutpb.TurnModel{}
	}
	tm = stripExtExpr(tm)
	tm.Version    = 1
	tm.MinVersion = 1
	tm.MaxVersion = 1
	raw, err := protojson.Marshal(tm)
	if err != nil {
		return err
	}
	var buf []byte
	if buf, err = json.MarshalIndent(json.RawMessage(raw), "", "  "); err != nil {
		return err
	}
	buf = append(buf, '\n')
	_, err = w.Write(buf)
	return err
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
	for _, b := range prog.Bindings {
		b.ExtExpr = nil
	}
}
