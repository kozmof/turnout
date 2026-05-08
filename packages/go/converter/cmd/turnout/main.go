package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "convert":
		os.Exit(runConvert(os.Args[2:]))
	case "validate":
		os.Exit(runValidate(os.Args[2:]))
	default:
		fmt.Fprintf(os.Stderr, "turnout: unknown command %q\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  turnout convert  <input.turn> [-o output.hcl] [-state-file path] [-format hcl|json]")
	fmt.Fprintln(os.Stderr, "  turnout validate <input.turn> [-state-file path]")
}

// compileResult bundles the artifacts of a successful parse→lower→validate run.
type compileResult struct {
	lr     *lower.LowerResult
	schema state.Schema
}

// compile runs parse → state-resolve → lower → validate for inputPath.
// stateBasePath is used to resolve state_file references. On any error it
// returns (nil, diags-with-errors); on success it returns (result, warnings).
func compile(inputPath, stateBasePath string) (*compileResult, diag.Diagnostics) {
	src, err := os.ReadFile(inputPath)
	if err != nil {
		return nil, diag.Diagnostics{diag.Errorf("IOError", "cannot read %s: %v", inputPath, err)}
	}

	turnFile, ds1 := parser.ParseFile(inputPath, string(src))
	if ds1.HasErrors() {
		return nil, ds1
	}

	schema, ds2 := state.Resolve(turnFile.StateSource, stateBasePath)
	if ds2.HasErrors() {
		return nil, ds2
	}

	lr, ds3 := lower.Lower(turnFile, schema)
	if ds3.HasErrors() {
		return nil, ds3
	}

	ds4 := validate.Validate(lr.Model, schema)
	if ds4.HasErrors() {
		return nil, ds4
	}

	return &compileResult{lr: lr, schema: schema}, ds4
}

func runConvert(args []string) int {
	fs := flag.NewFlagSet("convert", flag.ContinueOnError)
	output := fs.String("o", "", "output file path (use '-' for stdout; default: input with .hcl/.json extension)")
	stateFile := fs.String("state-file", "", "override state_file base path resolution")
	format := fs.String("format", "hcl", "output format: hcl or json")

	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "turnout convert: missing input file")
		fs.Usage()
		return 1
	}

	inputPath := fs.Arg(0)
	basePath := filepath.Dir(inputPath)
	if *stateFile != "" {
		basePath = *stateFile
	}

	result, ds := compile(inputPath, basePath)
	if ds.HasErrors() || result == nil {
		printDiags(ds)
		return 1
	}

	if *format != "hcl" && *format != "json" {
		fmt.Fprintf(os.Stderr, "turnout: unknown format %q (must be hcl or json)\n", *format)
		return 1
	}

	// Clear annotations before emission — they are validator-only metadata.
	result.lr.Model.Annotations = nil

	ext := "." + *format
	var w io.Writer
	if *output == "-" {
		w = os.Stdout
	} else {
		outPath := *output
		if outPath == "" {
			outPath = strings.TrimSuffix(inputPath, filepath.Ext(inputPath)) + ext
		}
		f, err := os.Create(outPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "turnout: cannot create %s: %v\n", outPath, err)
			return 1
		}
		defer f.Close()
		w = f
	}

	if *format == "json" {
		if err := emit.EmitJSON(w, result.lr.Model); err != nil {
			fmt.Fprintf(os.Stderr, "turnout: json emit failed: %v\n", err)
			return 1
		}
		return 0
	}

	ds5 := emit.Emit(w, result.lr.Model)
	if ds5.HasErrors() {
		printDiags(ds5)
		return 1
	}

	return 0
}

// runValidate runs parse → state resolve → lower → validate and exits 0 on
// success, 1 on any error. All diagnostics (including warnings) go to stderr.
func runValidate(args []string) int {
	fs := flag.NewFlagSet("validate", flag.ContinueOnError)
	stateFile := fs.String("state-file", "", "override state_file base path resolution")

	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "turnout validate: missing input file")
		fs.Usage()
		return 1
	}

	inputPath := fs.Arg(0)
	basePath := filepath.Dir(inputPath)
	if *stateFile != "" {
		basePath = *stateFile
	}

	_, ds := compile(inputPath, basePath)
	printDiags(ds)
	if ds.HasErrors() {
		return 1
	}
	return 0
}

func printDiags(ds diag.Diagnostics) {
	for _, d := range ds {
		fmt.Fprintln(os.Stderr, d.Format())
	}
}
