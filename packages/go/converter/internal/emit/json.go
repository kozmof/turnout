package emit

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

//go:generate sh -c "PATH=\"$HOME/go/bin:$(go env GOPATH)/bin:$PATH\" buf generate ../../../../../"

// EmitJSON marshals a validated proto model directly to indented JSON.
// ext_expr fields are stripped before marshalling — the runtime ignores them
// and they add unnecessary bytes to every #if/#case/#pipe binding.
func EmitJSON(w io.Writer, tm *turnoutpb.TurnModel) error {
	if tm == nil {
		tm = &turnoutpb.TurnModel{}
	}
	tm = stripExtExpr(tm)
	raw, err := protojson.Marshal(tm)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err = json.Indent(&buf, raw, "", "  "); err != nil {
		return err
	}
	buf.WriteByte('\n')
	_, err = w.Write(buf.Bytes())
	return err
}

// stripExtExpr returns a deep-cloned TurnModel with all BindingModel.ExtExpr
// fields set to nil. The runtime ignores ext_expr; only the HCL emitter uses it.
func stripExtExpr(tm *turnoutpb.TurnModel) *turnoutpb.TurnModel {
	clone := proto.Clone(tm).(*turnoutpb.TurnModel)
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
