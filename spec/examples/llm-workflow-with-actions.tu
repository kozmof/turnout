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

    compute "analyze_request_graph" {
      need_grounding:bool <~ @request.need_grounding
      kb_enabled:bool <~ @runtime.kb_enabled

      ("analyzed") ~> @workflow.stage

      retrieve_ready:bool := need_grounding & kb_enabled
    }

    next retrieve_ready -> retrieve_context
    next draft_direct
  }

  action "retrieve_context" {
    """
    Logic overview:
    - Read query and retrieval hint from STATE.
    - Build deterministic retrieval context text.
    - Persist context payload and stage metadata.
    """

    compute "retrieve_context_graph" {
      query:str <~ @request.query
      doc_hint:str <~ @request.doc_hint

      ("retrieved") ~> @workflow.stage

      retrieved_context:str := (query + " :: " + doc_hint) ~> @workflow.context
    }

    next draft_with_context
  }

  action "draft_direct" {
    """
    Logic overview:
    - Produce a direct draft from request text only.
    - Persist draft and stage metadata.
    """

    compute "draft_direct_graph" {
      query:str <~ @request.query

      ("drafted_direct") ~> @workflow.stage

      draft_text:str := ("Direct answer: " + query) ~> @workflow.draft
    }

    next safety_check
  }

  action "draft_with_context" {
    """
    Logic overview:
    - Read request text and retrieved context from STATE.
    - Produce a grounded draft.
    - Persist draft and stage metadata.
    """

    compute "draft_with_context_graph" {
      query:str <~ @request.query
      retrieved_context:str <~ @workflow.context

      ("drafted_with_context") ~> @workflow.stage

      draft_text:str := (query + " | " + retrieved_context) ~> @workflow.draft
    }

    next safety_check
  }

  action "safety_check" {
    """
    Logic overview:
    - Read moderation scores from STATE.
    - Approve when both toxicity and PII checks pass.
    - Persist approval result and stage metadata.
    """

    compute "safety_check_graph" {
      toxicity_score:number <~ @moderation.toxicity_score
      pii_score:number <~ @moderation.pii_score

      ("safety_checked") ~> @workflow.stage

      approved:bool := (
        toxicity_score <= 2 & pii_score <= 1
      ) ~> @workflow.approved
    }

    next approved -> publish_response
    next human_review
  }

  action "publish_response" {
    """
    Logic overview:
    - Read generated draft from STATE.
    - Publish final response and update workflow status.
    """

    compute "publish_response_graph" {
      draft_text:str <~ @workflow.draft

      ("sent") ~> @workflow.status

      final_response:str := (draft_text) ~> @conversation.last_response
    }

  }

  action "human_review" {
    """
    Logic overview:
    - Read generated draft from STATE.
    - Create a deterministic handoff note for a human operator.
    - Persist review note and workflow status.
    """

    compute "human_review_graph" {
      draft_text:str <~ @workflow.draft

      ("awaiting_human") ~> @workflow.status

      handoff_note:str := ("Review needed: " + draft_text) ~> @review.note
    }

  }
}
