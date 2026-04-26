package emit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"google.golang.org/protobuf/encoding/protojson"
)

//go:generate sh -c "PATH=\"$HOME/go/bin:$(go env GOPATH)/bin:$PATH\" buf generate ../../../../../"

// EmitJSON marshals a validated proto model directly to indented JSON.
// If a sidecar is provided, HCL-only extended expressions are rejected instead
// of being silently dropped from the proto JSON contract.
func EmitJSON(w io.Writer, tm *turnoutpb.TurnModel, sidecars ...*lower.Sidecar) error {
	for _, sc := range sidecars {
		if sc != nil && len(sc.ExtExprs) > 0 {
			return fmt.Errorf("json output does not support #if/#case/#pipe local expressions yet; use -format hcl")
		}
	}
	if tm == nil {
		tm = &turnoutpb.TurnModel{}
	}
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
