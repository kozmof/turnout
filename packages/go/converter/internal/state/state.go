package state

import (
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// DefaultMaxStateFileBytes bounds state_file reads performed by the compiler.
const DefaultMaxStateFileBytes int64 = 16 * 1024 * 1024

// FieldMeta holds the resolved type and default value for a single STATE field.
type FieldMeta struct {
	Type         ast.FieldType
	DefaultValue *structpb.Value
}

// Schema is the resolved STATE schema. Use Get("ns.field") for point lookups,
// Flat() when a dotted-path map is needed, and Namespaces()/FieldsOf() when
// iterating the structure. The zero value Schema{} is valid and represents an
// empty (no state declared) schema.
//
// Hash() returns a deterministic FNV-64a content hash over the schema's fields
// (in declaration order). LSP callers can compare Hash() values to detect
// whether the state source has changed between ResolveSchema calls without
// re-reading the state file from disk.
type Schema struct {
	namespaces map[string]map[string]FieldMeta
	hash       uint64
}

// Hash returns a deterministic FNV-64a hash of this schema's content in
// declaration order. Two schemas with the same fields, types, and defaults in
// the same declaration order produce the same hash. The zero value (Schema{})
// and schemas built via NewSchemaFromMap always return 0.
func (s Schema) Hash() uint64 { return s.hash }

// newSchema constructs a Schema with an empty namespace map. Only used within
// this package during schema resolution.
func newSchema() Schema {
	return Schema{namespaces: make(map[string]map[string]FieldMeta)}
}

// NewSchemaFromMap constructs a Schema from a pre-built namespace map.
// Intended for test helpers and programmatic schema construction when the DSL
// resolver is not available.
//
// The map is copied, two levels deep. It used to be adopted, which made the
// caller's map and the Schema's one object: a Schema is otherwise immutable
// once resolved, and every reader here is entitled to assume that, so a caller
// still holding the map could edit a schema mid-compile from outside. The copy
// is two levels because the inner maps are the ones with the fields in them;
// FieldMeta itself is a value, and its *structpb.Value default is shared, which
// is safe because nothing in the compiler writes through one.
//
// Schema.Hash() returns 0 for a schema built this way: hashing walks the
// declaration order, and a map has none. So do not compare a map-built schema
// to anything by Hash — two of them agree on 0 while declaring different
// fields. Compare with EqualContent, which is also what the cached-schema APIs
// (converter.CompileWithSchema and friends) use for an inline state block, and
// which a map-built schema passes when its content and the order handed
// alongside it really do match the source.
func NewSchemaFromMap(namespaces map[string]map[string]FieldMeta) Schema {
	copied := make(map[string]map[string]FieldMeta, len(namespaces))
	for ns, fields := range namespaces {
		inner := make(map[string]FieldMeta, len(fields))
		for name, meta := range fields {
			inner[name] = meta
		}
		copied[ns] = inner
	}
	return Schema{namespaces: copied}
}

// computeSchemaHash returns a deterministic FNV-64a hash over the schema
// content, visiting each field in the given declaration order. Fields absent
// from the schema (e.g. due to earlier errors) are silently skipped.
func computeSchemaHash(schema Schema, order []string) uint64 {
	h := fnv.New64a()
	for _, key := range order {
		meta, ok := schema.Get(key)
		if !ok {
			continue
		}
		fmt.Fprintf(h, "%s:%s", key, meta.Type.String())
		if meta.DefaultValue != nil {
			fmt.Fprintf(h, "=%s", meta.DefaultValue.String())
		}
	}
	return h.Sum64()
}

// fieldCount returns how many fields the schema declares across all namespaces.
func (s Schema) fieldCount() int {
	n := 0
	for _, fields := range s.namespaces {
		n += len(fields)
	}
	return n
}

// EqualContent reports whether s and other declare exactly the same fields,
// with the same types and defaults, walking order to visit them.
//
// This is what Hash() approximates. Hash exists for the caller that holds one
// schema and a number remembered from another, and it is an approximation on
// purpose: it is 64 bits, so two different schemas can agree on it. Where both
// schemas are in hand there is nothing to approximate, and a comparison that
// can be wrong should not be preferred to one that cannot.
//
// order is the declaration order of either schema; it must be the same for
// both, which the caller checks separately. A key in order that neither schema
// declares is skipped, the way computeSchemaHash skips it — an order can name a
// field that an earlier error kept out of the schema. What is not skipped is a
// field the order does not reach: the counts must agree, and the visit must
// cover every field of s, or one of the two is carrying something unexamined.
func (s Schema) EqualContent(other Schema, order []string) bool {
	if s.fieldCount() != other.fieldCount() {
		return false
	}
	visited := 0
	for _, key := range order {
		mine, mineOK := s.Get(key)
		theirs, theirsOK := other.Get(key)
		if mineOK != theirsOK {
			return false
		}
		if !mineOK {
			continue
		}
		visited++
		if mine.Type != theirs.Type {
			return false
		}
		if !proto.Equal(mine.DefaultValue, theirs.DefaultValue) {
			return false
		}
	}
	return visited == s.fieldCount()
}

// Get looks up a dotted path "ns.field" in the schema.
func (s Schema) Get(path string) (FieldMeta, bool) {
	dot := strings.IndexByte(path, '.')
	if dot < 0 {
		return FieldMeta{}, false
	}
	ns, field := path[:dot], path[dot+1:]
	fields, ok := s.namespaces[ns]
	if !ok {
		return FieldMeta{}, false
	}
	meta, ok := fields[field]
	return meta, ok
}

// Flat returns a flat map[string]FieldMeta keyed by "ns.field" dotted paths.
// Use sparingly — it allocates a new map each call.
func (s Schema) Flat() map[string]FieldMeta {
	out := make(map[string]FieldMeta)
	for ns, fields := range s.namespaces {
		for field, meta := range fields {
			out[ns+"."+field] = meta
		}
	}
	return out
}

// Namespaces returns the namespace names present in the schema (unordered).
func (s Schema) Namespaces() []string {
	names := make([]string, 0, len(s.namespaces))
	for ns := range s.namespaces {
		names = append(names, ns)
	}
	return names
}

// FieldsOf returns a copy of the field map for the given namespace.
func (s Schema) FieldsOf(ns string) (map[string]FieldMeta, bool) {
	fields, ok := s.namespaces[ns]
	if !ok {
		return nil, false
	}
	out := make(map[string]FieldMeta, len(fields))
	for k, v := range fields {
		out[k] = v
	}
	return out, true
}

// RangeFields calls fn for each field in the given namespace without allocating
// a copy of the internal map. Returns false if the namespace is not present.
// The iteration order is unspecified (map order). Use FieldsOf when a snapshot
// is needed; use RangeFields in the lowerer's hot path to avoid the copy.
func (s Schema) RangeFields(ns string, fn func(name string, meta FieldMeta)) bool {
	fields, ok := s.namespaces[ns]
	if !ok {
		return false
	}
	for name, meta := range fields {
		fn(name, meta)
	}
	return true
}

// RangeAll calls fn for every field across all namespaces without allocating.
// The iteration order is unspecified (map order). Use instead of Flat() when a
// snapshot is not needed and full iteration is sufficient.
func (s Schema) RangeAll(fn func(ns, field string, meta FieldMeta)) {
	for ns, fields := range s.namespaces {
		for field, meta := range fields {
			fn(ns, field, meta)
		}
	}
}

// Resolve builds a Schema from a StateSource.
// basePath is the directory of the input .tu file, used to resolve relative state_file paths.
func Resolve(source ast.StateSource, basePath string) (Schema, diag.Diagnostics) {
	schema, _, ds := ResolveWithOrder(source, basePath)
	return schema, ds
}

// ResolveWithOrder is like Resolve but also returns the dotted field keys in
// declaration order (namespace order, then field order within each namespace).
// The lower package uses the order to preserve field sequence in emitted HCL
// when the source uses state_file. Callers that do not need ordering can
// ignore the second return value.
func ResolveWithOrder(source ast.StateSource, basePath string) (Schema, []string, diag.Diagnostics) {
	return ResolveWithOrderLimit(source, basePath, DefaultMaxStateFileBytes)
}

// ResolveWithOrderLimit is ResolveWithOrder with an explicit state_file byte limit.
func ResolveWithOrderLimit(source ast.StateSource, basePath string, maxBytes int64) (Schema, []string, diag.Diagnostics) {
	return resolveWithOrder(source, basePath, false, maxBytes)
}

// ResolveWithOrderContained is like ResolveWithOrder, but constrains state_file
// directives to basePath. Relative state_file paths are resolved under basePath;
// absolute paths and symlinks must also resolve inside basePath.
func ResolveWithOrderContained(source ast.StateSource, basePath string) (Schema, []string, diag.Diagnostics) {
	return ResolveWithOrderContainedLimit(source, basePath, DefaultMaxStateFileBytes)
}

// ResolveWithOrderContainedLimit is ResolveWithOrderContained with an explicit byte limit.
func ResolveWithOrderContainedLimit(source ast.StateSource, basePath string, maxBytes int64) (Schema, []string, diag.Diagnostics) {
	return resolveWithOrder(source, basePath, true, maxBytes)
}

func resolveWithOrder(source ast.StateSource, basePath string, containStateFile bool, maxBytes int64) (Schema, []string, diag.Diagnostics) {
	switch s := source.(type) {
	case *ast.InlineStateBlock:
		schema, ds := resolveInline(s)
		order := inlineOrder(s)
		if !ds.HasErrors() {
			schema.hash = computeSchemaHash(schema, order)
		}
		return schema, order, ds
	case *ast.StateFileDirective:
		schema, order, ds := resolveStateFileWithOrder(s, basePath, containStateFile, maxBytes)
		if !ds.HasErrors() {
			schema.hash = computeSchemaHash(schema, order)
		}
		return schema, order, ds
	default:
		return Schema{}, nil, diag.Diagnostics{diag.Errorf(diag.CodeMissingStateSource, "no state source")}
	}
}

// inlineOrder returns the dotted keys for block in declaration order.
func inlineOrder(block *ast.InlineStateBlock) []string {
	var keys []string
	for _, ns := range block.Namespaces {
		for _, f := range ns.Fields {
			keys = append(keys, ns.Name+"."+f.Name)
		}
	}
	return keys
}

func pathInsideBase(path, base string) bool {
	rel, err := filepath.Rel(base, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel))
}

func resolveContainedStatePath(rawPath, basePath string) (string, diag.Diagnostics) {
	base, err := filepath.Abs(basePath)
	if err != nil {
		return "", diag.Diagnostics{diag.Errorf(diag.CodeStateFileOutsideBase, "cannot resolve state_file base %q: %v", basePath, err)}
	}
	path := rawPath
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	path = filepath.Clean(path)
	if !pathInsideBase(path, base) {
		return "", diag.Diagnostics{diag.Errorf(diag.CodeStateFileOutsideBase, "state_file %q resolves outside base directory %q", rawPath, basePath)}
	}

	realBase, baseErr := filepath.EvalSymlinks(base)
	realPath, pathErr := filepath.EvalSymlinks(path)
	if baseErr == nil && pathErr == nil && !pathInsideBase(realPath, realBase) {
		return "", diag.Diagnostics{diag.Errorf(diag.CodeStateFileOutsideBase, "state_file %q resolves outside base directory %q", rawPath, basePath)}
	}
	return path, nil
}

// readOpenedContainedStateFile verifies that f is the same inode currently
// reached by path and that the resolved path remains inside basePath. Reading
// from f after this check prevents a later symlink swap from redirecting I/O.
func readOpenedContainedStateFile(f *os.File, path, basePath string) ([]byte, diag.Diagnostics) {
	return readOpenedContainedStateFileLimit(f, path, basePath, DefaultMaxStateFileBytes)
}

func readOpenedContainedStateFileLimit(f *os.File, path, basePath string, maxBytes int64) ([]byte, diag.Diagnostics) {
	realBase, err := filepath.EvalSymlinks(basePath)
	if err != nil {
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileOutsideBase,
			"cannot resolve state_file base %q: %v", basePath, err)}
	}
	realPath, err := filepath.EvalSymlinks(path)
	if err != nil || !pathInsideBase(realPath, realBase) {
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileOutsideBase,
			"state_file %q no longer resolves inside base directory %q", path, basePath)}
	}
	openedInfo, err := f.Stat()
	if err != nil {
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileMissing,
			"cannot inspect state file %q: %v", path, err)}
	}
	pathInfo, err := os.Stat(realPath)
	if err != nil || !os.SameFile(openedInfo, pathInfo) {
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileOutsideBase,
			"state_file %q changed while being opened", path)}
	}
	src, err := readLimited(f, maxBytes)
	if err != nil {
		if errors.Is(err, errFileTooLarge) {
			return nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileTooLarge,
				"state file %q exceeds the %d-byte limit", path, maxBytes)}
		}
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileMissing,
			"cannot read state file %q: %v", path, err)}
	}
	return src, nil
}

// resolveStateFileWithOrder is like Resolve but also returns ordered keys.
func resolveStateFileWithOrder(d *ast.StateFileDirective, basePath string, containStateFile bool, maxBytes int64) (Schema, []string, diag.Diagnostics) {
	path := d.Path
	if containStateFile {
		var ds diag.Diagnostics
		path, ds = resolveContainedStatePath(path, basePath)
		if ds.HasErrors() {
			return Schema{}, nil, ds
		}
	} else if !filepath.IsAbs(path) {
		path = filepath.Join(basePath, path)
	}

	var src []byte
	if containStateFile {
		f, err := os.Open(path)
		if err != nil {
			return Schema{}, nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileMissing, "cannot read state file %q: %v", path, err)}
		}
		defer f.Close()
		var ds diag.Diagnostics
		src, ds = readOpenedContainedStateFileLimit(f, path, basePath, maxBytes)
		if ds.HasErrors() {
			return Schema{}, nil, ds
		}
	} else {
		f, err := os.Open(path)
		if err != nil {
			return Schema{}, nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileMissing, "cannot read state file %q: %v", path, err)}
		}
		defer f.Close()
		src, err = readLimited(f, maxBytes)
		if err != nil {
			if errors.Is(err, errFileTooLarge) {
				return Schema{}, nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileTooLarge,
					"state file %q exceeds the %d-byte limit", path, maxBytes)}
			}
			return Schema{}, nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileMissing, "cannot read state file %q: %v", path, err)}
		}
	}

	inline, parseDiags := parser.ParseStateFile(path, string(src))
	if parseDiags.HasErrors() {
		var ds diag.Diagnostics
		for _, pd := range parseDiags {
			ds = append(ds, diag.ErrorAt(pd.File, pd.Line, pd.Col, stateFileParseCode(pd), "%s", pd.Message))
		}
		return Schema{}, nil, ds
	}

	schema, ds := resolveInline(inline)
	return schema, inlineOrder(inline), ds
}

var errFileTooLarge = errors.New("file exceeds byte limit")

func readLimited(r io.Reader, maxBytes int64) ([]byte, error) {
	if maxBytes < 1 {
		return nil, errFileTooLarge
	}
	src, err := io.ReadAll(io.LimitReader(r, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(src)) > maxBytes {
		return nil, errFileTooLarge
	}
	return src, nil
}

// stateFileParseCode maps a parser diagnostic code to the appropriate
// state-file-level code. Most codes become CodeStateFileParseError; a small
// subset (e.g. CodeMissingStateBlock) are preserved so callers can distinguish
// structural issues from generic parse failures.
func stateFileParseCode(pd diag.Diagnostic) diag.ErrorCode {
	switch pd.Code {
	case diag.CodeMissingStateBlock:
		return diag.CodeMissingStateBlock
	case diag.CodeInvalidStateFieldType:
		return diag.CodeInvalidStateFieldType
	default:
		return diag.CodeStateFileParseError
	}
}

// resolveInline builds a Schema from an InlineStateBlock.
func resolveInline(block *ast.InlineStateBlock) (Schema, diag.Diagnostics) {
	schema := newSchema()
	var ds diag.DiagSink

	seenNS := make(map[string]bool)
	for _, ns := range block.Namespaces {
		if seenNS[ns.Name] {
			ds.Append(diag.ErrorAt(ns.Pos.File, ns.Pos.Line, ns.Pos.Col,
				diag.CodeDuplicateStateNamespace,
				"duplicate namespace %q", ns.Name))
			continue
		}
		seenNS[ns.Name] = true
		schema.namespaces[ns.Name] = make(map[string]FieldMeta)

		seenField := make(map[string]bool)
		for _, f := range ns.Fields {
			if seenField[f.Name] {
				ds.Append(diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col,
					diag.CodeDuplicateStateField,
					"duplicate field %q in namespace %q", f.Name, ns.Name))
				continue
			}
			seenField[f.Name] = true

			if f.Default == nil {
				ds.Append(diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col,
					diag.CodeMissingStateFieldAttr,
					"field %q.%q has no default value", ns.Name, f.Name))
				continue
			}

			if !literalMatchesType(f.Default, f.Type) {
				ds.Append(diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col,
					diag.CodeStateFieldDefaultTypeMismatch,
					"field %q.%q: default value does not match declared type %s", ns.Name, f.Name, f.Type))
				continue
			}

			schema.namespaces[ns.Name][f.Name] = FieldMeta{Type: f.Type, DefaultValue: ast.LiteralToStructpb(f.Default)}
		}
	}

	return schema, ds.Flush()
}

// literalMatchesType reports whether lit is compatible with the declared FieldType.
// See also state.StructpbFieldType, which performs the equivalent check at the
// proto structpb level.
func literalMatchesType(lit ast.Literal, ft ast.FieldType) bool {
	switch ft {
	case ast.FieldTypeNumber:
		_, ok := lit.(*ast.NumberLiteral)
		return ok
	case ast.FieldTypeStr:
		_, ok := lit.(*ast.StringLiteral)
		return ok
	case ast.FieldTypeBool:
		_, ok := lit.(*ast.BoolLiteral)
		return ok
	}
	if elemFT, ok := ft.TryElemType(); ok {
		arr, ok := lit.(*ast.ArrayLiteral)
		if !ok {
			return false
		}
		for _, e := range arr.Elements {
			if !literalMatchesType(e, elemFT) {
				return false
			}
		}
		return true
	}
	if ft.IsRecord() {
		_, ok := lit.(*ast.RecordLiteral)
		return ok
	}
	return false
}
