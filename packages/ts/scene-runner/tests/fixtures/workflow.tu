state {
  request {
    need_grounding:bool   = false
    kb_enabled:bool       = false
    toxicity_score:number = 0
    query:str             = ""
    doc_hint:str          = ""
  }
  workflow {
    stage:str   = ""
    context:str = ""
    draft:str   = ""
    status:str  = ""
  }
  review {
    note:str = ""
  }
  response {
    last:str = ""
  }
}

scene "ai_workflow" {
  entry_action = analyze

  action "analyze" {
    compute "analyze_prog" {
      need_grounding:bool <~ @request.need_grounding
      kb_enabled:bool <~ @request.kb_enabled
      retrieve_ready:bool = need_grounding & kb_enabled
      analysis_done:bool := true
    }
    next {
      compute "to_retrieve" {
        retrieve_ready:bool <~ action(retrieve_ready)
        go_retrieve:bool := retrieve_ready
      }
      action = retrieve
    }
    next {
      action = draft_direct
    }
  }

  action "retrieve" {
    compute "retrieve_prog" {
      doc_hint:str <~ @request.doc_hint
      prefix:str      = "Retrieved: "
      context_str:str := (prefix + doc_hint) ~> @workflow.context
    }
    next {
      action = draft_with_context
    }
  }

  action "draft_direct" {
    compute "draft_direct_prog" {
      query:str <~ @request.query
      prefix:str      = "Direct answer: "
      draft_text:str := (prefix + query) ~> @workflow.draft
    }
    next {
      action = safety_check
    }
  }

  action "draft_with_context" {
    compute "draft_ctx_prog" {
      query:str <~ @request.query
      context:str <~ @workflow.context
      sep:str       = " [ctx:"
      close:str     = "]"
      mid:str        = query + sep
      mid2:str        = mid + context
      draft_text:str := (mid2 + close) ~> @workflow.draft
    }
    next {
      action = safety_check
    }
  }

  action "safety_check" {
    compute "safety_prog" {
      toxicity:number <~ @request.toxicity_score
      threshold:number  = 3
      safe:bool := toxicity <= threshold
    }
    next {
      compute "to_publish" {
        safe:bool <~ action(safe)
        go_publish:bool := safe
      }
      action = "publish"
    }
    next {
      action = human_review
    }
  }

  action "publish" {
    compute "publish_prog" {
      draft:str <~ @workflow.draft
      status:str = ("sent") ~> @workflow.status
      final_response:str := (draft) ~> @response.last
    }
  }

  action "human_review" {
    compute "review_prog" {
      draft:str <~ @workflow.draft
      prefix:str           = "Review needed: "
      status:str = ("awaiting_human") ~> @workflow.status
      review_note:str := (prefix + draft) ~> @review.note
    }
  }
}
