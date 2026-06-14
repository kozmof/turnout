package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	converter "github.com/kozmof/turnout/packages/go/converter"
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
	basePath := filepath.Dir(inputPath)
	if *stateFile != "" {
		basePath = *stateFile
	}

	if *format != "hcl" && *format != "json" {
		fmt.Fprintf(os.Stderr, "turnout: unknown format %q (must be hcl or json)\n", *format)
		return 1
	}

	ext := "." + *format
	outPath := *output
	if outPath == "" {
		outPath = strings.TrimSuffix(inputPath, filepath.Ext(inputPath)) + ext
	}

	if outPath == "-" {
		return runConvertToWriter(os.Stdout, inputPath, basePath, *format)
	}

	// Write to a temp file in the same directory so os.Rename is atomic on
	// POSIX (same filesystem). On failure the temp file is removed, leaving
	// any pre-existing outPath untouched.
	tmp, err := os.CreateTemp(filepath.Dir(outPath), ".turnout-*.tmp")
	if err != nil {
		fmt.Fprintf(os.Stderr, "turnout: cannot create %s: %v\n", outPath, err)
		return 1
	}
	tmpName := tmp.Name()
	success := false
	defer func() {
		if !success {
			os.Remove(tmpName)
		}
	}()

	code := runConvertToWriter(tmp, inputPath, basePath, *format)
	tmp.Close()
	if code != 0 {
		return code
	}
	if err := os.Rename(tmpName, outPath); err != nil {
		fmt.Fprintf(os.Stderr, "turnout: cannot write %s: %v\n", outPath, err)
		return 1
	}
	success = true
	return 0
}

func runConvertToWriter(w io.Writer, inputPath, basePath, format string) int {
	result, ds := converter.Compile(inputPath, basePath)
	if ds.HasErrors() || result == nil {
		printDiags(ds)
		return 1
	}
	printDiags(ds) // emit any compile warnings

	var emitDs converter.Diagnostics
	if format == "json" {
		emitDs = result.WriteJSON(w)
	} else {
		emitDs = result.WriteHCL(w)
	}
	if emitDs.HasErrors() {
		printDiags(emitDs)
		return 1
	}
	printDiags(emitDs) // emit any warnings from the emitter
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

	result, ds := converter.Compile(inputPath, basePath)
	printDiags(ds)
	if ds.HasErrors() {
		return 1
	}
	if result != nil {
		printDiags(result.Warnings)
	}
	return 0
}

func printDiags(ds converter.Diagnostics) {
	for _, d := range ds {
		fmt.Fprintln(os.Stderr, d.Format())
	}
}
