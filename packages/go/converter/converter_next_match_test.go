package converter_test

import (
	"bytes"
	"testing"

	converter "github.com/kozmof/turnout/packages/go/converter"
)

// nextMatchSrc and nextMatchHandWrittenSrc are the same scene twice: once with
// the match block, once with the next rules it abbreviates.
const nextMatchSrc = `
state {
  routing {
    tier:str = ""
    region:str = ""
    urgent:bool = false
  }
}

scene "support" {
  entry_action = classify

  action "classify" {
    compute "classify_graph" {
      tier:str <~ @routing.tier
      region:str <~ @routing.region
      urgent:bool <~ @routing.urgent
      ready:bool := true
    }

    next on (tier, region, urgent) to {
      ("gold", "eu", true) => escalate,
      ("gold", _, false)   => review,
      _ => archive
    }
  }

  action "escalate" { compute "escalate_graph" { done:bool := true } }
  action "review"   { compute "review_graph"   { done:bool := true } }
  action "archive"  { compute "archive_graph"  { done:bool := true } }
}
`

const nextMatchHandWrittenSrc = `
state {
  routing {
    tier:str = ""
    region:str = ""
    urgent:bool = false
  }
}

scene "support" {
  entry_action = classify

  action "classify" {
    compute "classify_graph" {
      tier:str <~ @routing.tier
      region:str <~ @routing.region
      urgent:bool <~ @routing.urgent
      ready:bool := true
    }

    next {
      compute "__local_escalate_match_0" {
        tier:str <~ action(tier)
        region:str <~ action(region)
        urgent:bool <~ action(urgent)
        __local_escalate_go_0:bool := tier == "gold" & region == "eu" & urgent == true
      }
      action = escalate
    }
    next {
      compute "__local_review_match_1" {
        tier:str <~ action(tier)
        urgent:bool <~ action(urgent)
        __local_review_go_1:bool := tier == "gold" & urgent == false
      }
      action = review
    }
    next archive
  }

  action "escalate" { compute "escalate_graph" { done:bool := true } }
  action "review"   { compute "review_graph"   { done:bool := true } }
  action "archive"  { compute "archive_graph"  { done:bool := true } }
}
`

func compileToJSON(t *testing.T, name, src string) []byte {
	t.Helper()
	result, ds := converter.CompileSource(name, src, "")
	if ds.HasErrors() {
		for _, d := range ds {
			t.Logf("diag: %s", d.Format())
		}
		t.Fatalf("%s: compile returned errors", name)
	}
	var buf bytes.Buffer
	if out := result.WriteJSON(&buf); out.HasErrors() {
		t.Fatalf("%s: WriteJSON returned errors", name)
	}
	return buf.Bytes()
}

// TestNextMatchEmitsTheBlockFormItAbbreviates is the load-bearing test for the
// match block being pure surface sugar. The two sources below are the same
// scene written two ways; if their emitted models are identical then nothing
// downstream — lower, emit, the wire model, the runtime — can observe which
// spelling was used, which is why the feature needs no proto or runtime change.
func TestNextMatchEmitsTheBlockFormItAbbreviates(t *testing.T) {
	sugar := compileToJSON(t, "match.tu", nextMatchSrc)
	hand := compileToJSON(t, "hand.tu", nextMatchHandWrittenSrc)

	if !bytes.Equal(sugar, hand) {
		t.Errorf("match block and hand-written rules emit different models\n\nmatch form:\n%s\n\nhand-written:\n%s", sugar, hand)
	}
}
