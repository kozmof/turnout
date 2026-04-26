package emit

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/encoding/protojson"
)

//go:generate sh -c "PATH=\"$HOME/go/bin:$(go env GOPATH)/bin:$PATH\" buf generate ../../../../../"

// EmitJSON marshals a validated proto model directly to indented JSON.
func EmitJSON(w io.Writer, tm *turnoutpb.TurnModel) error {
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
