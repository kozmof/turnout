state {
  request {
    query:str            = ""
    doc_hint:str         = ""
    priority_tier:number = 0
    need_grounding:bool = false
  }
  runtime {
    kb_enabled:bool = false
  }
  workflow {
    stage:str     = ""
    context:str   = ""
    draft:str     = ""
    status:str    = ""
    approved:bool = false
  }
  moderation {
    toxicity_score:number = 0
    pii_score:number      = 0
  }
  conversation {
    last_response:str = ""
  }
  review {
    note:str = ""
  }
}

scene "llm_support_workflow" {
  entry_actions     = [analyze_request]
  next_policy       = "first-match"

  overview at_least {
    analyze_request |=> retrieve_context
    analyze_request |=> draft_direct
    retrieve_context |=> draft_with_context
    draft_direct |=> safety_check
    draft_with_context |=> safety_check
    safety_check |=> publish_response
    safety_check |=> human_review
  }

  action "analyze_request" {
    """
    Logic overview:
    - Read request-level routing flags from STATE.
    - Decide whether retrieval is needed for this turn.
    - Persist workflow stage metadata.
    """

    compute {
      prog "analyze_request_graph" {
        need_grounding:bool <~ @request.need_grounding
        kb_enabled:bool <~ @runtime.kb_enabled
        priority_tier:number <~ @request.priority_tier
        workflow_stage:str = "analyzed" ~> @workflow.stage

        retrieve_ready:bool = need_grounding & kb_enabled
        fast_lane:bool = priority_tier >= 2
        |^| analysis_ready:bool = true
      }
    }

    next {
      compute {
        prog "to_retrieve_context" {
          retrieve_ready:bool <~ action(retrieve_ready)
          |?| go_retrieve:bool = retrieve_ready
        }
      }
      action = retrieve_context
    }

    next {
      action = draft_direct
    }
  }

  action "retrieve_context" {
    """
    Logic overview:
    - Read query and retrieval hint from STATE.
    - Build deterministic retrieval context text.
    - Persist context payload and stage metadata.
    """

    compute {
      prog "retrieve_context_graph" {
        query:str <~ @request.query
        doc_hint:str <~ @request.doc_hint
        workflow_stage:str = "retrieved" ~> @workflow.stage

        context_prefix:str = query + " :: "
        retrieved_context:str = context_prefix + doc_hint ~> @workflow.context
        |^| retrieval_ready:bool = true
      }
    }

    next {
      action = draft_with_context
    }
  }

  action "draft_direct" {
    """
    Logic overview:
    - Produce a direct draft from request text only.
    - Persist draft and stage metadata.
    """

    compute {
      prog "draft_direct_graph" {
        query:str <~ @request.query
        prefix:str = "Direct answer: "
        draft_text:str = prefix + query ~> @workflow.draft
        workflow_stage:str = "drafted_direct" ~> @workflow.stage
        |^| draft_ready:bool = true
      }
    }

    next {
      action = safety_check
    }
  }

  action "draft_with_context" {
    """
    Logic overview:
    - Read request text and retrieved context from STATE.
    - Produce a grounded draft.
    - Persist draft and stage metadata.
    """

    compute {
      prog "draft_with_context_graph" {
        query:str <~ @request.query
        retrieved_context:str <~ @workflow.context
        workflow_stage:str = "drafted_with_context" ~> @workflow.stage

        draft_seed:str = query + " | "
        draft_text:str = draft_seed + retrieved_context ~> @workflow.draft
        |^| draft_ready:bool = true
      }
    }

    next {
      action = safety_check
    }
  }

  action "safety_check" {
    """
    Logic overview:
    - Read moderation scores from STATE.
    - Approve when both toxicity and PII checks pass.
    - Persist approval result and stage metadata.
    """

    compute {
      prog "safety_check_graph" {
        toxicity_score:number <~ @moderation.toxicity_score
        pii_score:number <~ @moderation.pii_score
        workflow_stage:str = "safety_checked" ~> @workflow.stage

        toxicity_ok:bool = toxicity_score <= 2
        pii_ok:bool = pii_score <= 1
        approved:bool = toxicity_ok & pii_ok ~> @workflow.approved
        |^| safety_ready:bool = true
      }
    }

    next {
      compute {
        prog "to_publish_response" {
          approved:bool <~ action(approved)
          |?| go_publish:bool = approved
        }
      }
      action = publish_response
    }

    next {
      action = human_review
    }
  }

  action "publish_response" {
    """
    Logic overview:
    - Read generated draft from STATE.
    - Publish final response and update workflow status.
    """

    compute {
      prog "publish_response_graph" {
        draft_text:str <~ @workflow.draft
        workflow_status:str = "sent" ~> @workflow.status
        final_response:str = draft_text ~> @conversation.last_response
        |^| publish_ready:bool = true
      }
    }

  }

  action "human_review" {
    """
    Logic overview:
    - Read generated draft from STATE.
    - Create a deterministic handoff note for a human operator.
    - Persist review note and workflow status.
    """

    compute {
      prog "human_review_graph" {
        draft_text:str <~ @workflow.draft
        prefix:str = "Review needed: "
        handoff_note:str = prefix + draft_text ~> @review.note
        workflow_status:str = "awaiting_human" ~> @workflow.status
        |^| handoff_ready:bool = true
      }
    }

  }
}
