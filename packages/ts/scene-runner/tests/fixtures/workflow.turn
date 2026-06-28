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
  entry_actions = ["analyze"]
  next_policy   = "first-match"

  action "analyze" {
    compute {
      prog "analyze_prog" {
        ~>need_grounding:bool
        ~>kb_enabled:bool
        retrieve_ready:bool = need_grounding & kb_enabled
        |^| analysis_done:bool  = true
      }
    }
    prepare {
      need_grounding { from_state = request.need_grounding }
      kb_enabled     { from_state = request.kb_enabled     }
    }
    next {
      compute {
        prog "to_retrieve" {
          ~>retrieve_ready:bool
          |?| go_retrieve:bool = retrieve_ready
        }
      }
      prepare {
        retrieve_ready { from_action = retrieve_ready }
      }
      action = retrieve
    }
    next {
      action = draft_direct
    }
  }

  action "retrieve" {
    compute {
      prog "retrieve_prog" {
        ~>doc_hint:str
        prefix:str      = "Retrieved: "
        |^| <~context_str:str = prefix + doc_hint
      }
    }
    prepare {
      doc_hint { from_state = request.doc_hint }
    }
    merge {
      context_str { to_state = workflow.context }
    }
    next {
      action = draft_with_context
    }
  }

  action "draft_direct" {
    compute {
      prog "draft_direct_prog" {
        ~>query:str
        prefix:str      = "Direct answer: "
        |^| <~draft_text:str = prefix + query
      }
    }
    prepare {
      query { from_state = request.query }
    }
    merge {
      draft_text { to_state = workflow.draft }
    }
    next {
      action = safety_check
    }
  }

  action "draft_with_context" {
    compute {
      prog "draft_ctx_prog" {
        ~>query:str
        ~>context:str
        sep:str       = " [ctx:"
        close:str     = "]"
        mid:str        = query + sep
        mid2:str        = mid + context
        |^| <~draft_text:str = mid2 + close
      }
    }
    prepare {
      query   { from_state = request.query    }
      context { from_state = workflow.context }
    }
    merge {
      draft_text { to_state = workflow.draft }
    }
    next {
      action = safety_check
    }
  }

  action "safety_check" {
    compute {
      prog "safety_prog" {
        ~>toxicity:number
        threshold:number  = 3
        |^| safe:bool = toxicity <= threshold
      }
    }
    prepare {
      toxicity { from_state = request.toxicity_score }
    }
    next {
      compute {
        prog "to_publish" {
          ~>safe:bool
          |?| go_publish:bool = safe
        }
      }
      prepare {
        safe { from_action = safe }
      }
      action = "publish"
    }
    next {
      action = human_review
    }
  }

  action "publish" {
    compute {
      prog "publish_prog" {
        ~>draft:str
        <~status:str         = "sent"
        |^| <~final_response:str = draft
      }
    }
    prepare {
      draft { from_state = workflow.draft }
    }
    merge {
      final_response { to_state = response.last    }
      status         { to_state = workflow.status  }
    }
  }

  action "human_review" {
    compute {
      prog "review_prog" {
        ~>draft:str
        prefix:str           = "Review needed: "
        <~status:str         = "awaiting_human"
        |^| <~review_note:str    = prefix + draft
      }
    }
    prepare {
      draft { from_state = workflow.draft }
    }
    merge {
      review_note { to_state = review.note       }
      status      { to_state = workflow.status   }
    }
  }
}
