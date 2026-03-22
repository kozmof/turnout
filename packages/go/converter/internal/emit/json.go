package emit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/turnout/converter/internal/lower"
	"google.golang.org/protobuf/encoding/protojson"
)

//go:generate sh -c "PATH=\"$HOME/go/bin:$(go env GOPATH)/bin:$PATH\" buf generate ../../../../../"

// EmitJSON converts a validated lower.Model to indented JSON via the canonical
// HCL intermediate representation:
//
//	lower.Model → HCL text (Emit) → hcl-lang parse/validate → decode → JSON
//
// The HCL text is both the validation gate and the source for JSON: if the
// emitted HCL fails schema validation the error is surfaced before any JSON is
// written.
func EmitJSON(w io.Writer, model *lower.Model) error {
	// Step 1: emit canonical plain HCL to a buffer.
	var hclBuf bytes.Buffer
	if ds := Emit(&hclBuf, model); ds.HasErrors() {
		return fmt.Errorf("hcl emit: %s", ds[0].Message)
	}

	// Step 2: parse the emitted HCL and validate it against the hcl-lang schema.
	hclBytes := hclBuf.Bytes()
	f, diags := validateHCL(hclBytes)
	if diags.HasErrors() {
		return fmt.Errorf("hcl validation: %s", formatHCLDiags(diags))
	}

	// Step 3: decode the validated HCL body into the protobuf model.
	tm, diags := decodeHCLBody(f.Body)
	if diags.HasErrors() {
		return fmt.Errorf("hcl decode: %s", formatHCLDiags(diags))
	}

	// Step 4: marshal to compact JSON, then re-indent for human readability.
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

// formatHCLDiags returns a compact multi-line summary of hcl.Diagnostics.
func formatHCLDiags(diags hcl.Diagnostics) string {
	var sb strings.Builder
	for i, d := range diags {
		if d.Severity != hcl.DiagError {
			continue
		}
		if i > 0 {
			sb.WriteString("; ")
		}
		if d.Subject != nil {
			fmt.Fprintf(&sb, "%s: %s", d.Subject, d.Summary)
		} else {
			sb.WriteString(d.Summary)
		}
		if d.Detail != "" {
			sb.WriteString(": ")
			sb.WriteString(d.Detail)
		}
	}
	return sb.String()
}
