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

	src, err := os.ReadFile(inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "turnout: cannot read %s: %v\n", inputPath, err)
		return 1
	}

	turnFile, ds := parser.ParseFile(inputPath, string(src))
	if ds.HasErrors() {
		printDiags(ds)
		return 1
	}

	basePath := filepath.Dir(inputPath)
	if *stateFile != "" {
		basePath = *stateFile
	}
	schema, ds2 := state.Resolve(turnFile.StateSource, basePath)
	if ds2.HasErrors() {
		printDiags(ds2)
		return 1
	}

	lr, ds3 := lower.Lower(turnFile, schema)
	if ds3.HasErrors() {
		printDiags(ds3)
		return 1
	}

	ds4 := validate.Validate(lr.Model, schema)
	if ds4.HasErrors() {
		printDiags(ds4)
		return 1
	}

	// Clear annotations before emission — they are validator-only metadata.
	lr.Model.Annotations = nil

	if *format != "hcl" && *format != "json" {
		fmt.Fprintf(os.Stderr, "turnout: unknown format %q (must be hcl or json)\n", *format)
		return 1
	}

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
		if err := emit.EmitJSON(w, lr.Model); err != nil {
			fmt.Fprintf(os.Stderr, "turnout: json emit failed: %v\n", err)
			return 1
		}
		return 0
	}

	ds5 := emit.Emit(w, lr.Model)
	if ds5.HasErrors() {
		printDiags(ds5)
		return 1
	}

	return 0
}

// runValidate runs parse → state resolve → lower → validate and exits 0 on
// success, 1 on any error. No output is produced; diagnostics go to stderr.
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
	src, err := os.ReadFile(inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "turnout: cannot read %s: %v\n", inputPath, err)
		return 1
	}

	turnFile, ds := parser.ParseFile(inputPath, string(src))
	if ds.HasErrors() {
		printDiags(ds)
		return 1
	}

	basePath := filepath.Dir(inputPath)
	if *stateFile != "" {
		basePath = *stateFile
	}
	schema, ds2 := state.Resolve(turnFile.StateSource, basePath)
	if ds2.HasErrors() {
		printDiags(ds2)
		return 1
	}

	lr, ds3 := lower.Lower(turnFile, schema)
	if ds3.HasErrors() {
		printDiags(ds3)
		return 1
	}

	ds4 := validate.Validate(lr.Model, schema)
	printDiags(ds4)
	if ds4.HasErrors() {
		return 1
	}
	return 0
}

func printDiags(ds diag.Diagnostics) {
	for _, d := range ds {
		fmt.Fprintln(os.Stderr, d.Format())
	}
}
