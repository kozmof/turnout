state {
  namespace "request" {
    field "need_grounding" {
      type  = "bool"
      value = false
    }
    field "kb_enabled" {
      type  = "bool"
      value = false
    }
    field "toxicity_score" {
      type  = "number"
      value = 0
    }
    field "query" {
      type  = "str"
      value = ""
    }
    field "doc_hint" {
      type  = "str"
      value = ""
    }
  }
  namespace "workflow" {
    field "stage" {
      type  = "str"
      value = ""
    }
    field "context" {
      type  = "str"
      value = ""
    }
    field "draft" {
      type  = "str"
      value = ""
    }
    field "status" {
      type  = "str"
      value = ""
    }
  }
  namespace "review" {
    field "note" {
      type  = "str"
      value = ""
    }
  }
  namespace "response" {
    field "last" {
      type  = "str"
      value = ""
    }
  }
}

scene "ai_workflow" {
  entry_actions = ["analyze"]
  next_policy   = "first-match"

  action "analyze" {
    compute {
      root = "analysis_done"
      prog "analyze_prog" {
        binding "need_grounding" {
          type  = "bool"
          value = false
        }
        binding "kb_enabled" {
          type  = "bool"
          value = false
        }
        binding "retrieve_ready" {
          type  = "bool"
          expr  = {
            combine = {
              fn   = "bool_and"
              args = [{ ref = "need_grounding" }, { ref = "kb_enabled" }]
            }
          }
        }
        binding "analysis_done" {
          type  = "bool"
          value = true
        }
      }
    }

    prepare {
      binding "need_grounding" {
        from_state = "request.need_grounding"
      }
      binding "kb_enabled" {
        from_state = "request.kb_enabled"
      }
    }

    next {
      compute {
        condition = "go_retrieve"
        prog "to_retrieve" {
          binding "retrieve_ready" {
            type  = "bool"
            value = false
          }
          binding "go_retrieve" {
            type  = "bool"
            expr  = {
              combine = {
                fn   = "bool_and"
                args = [{ ref = "retrieve_ready" }, { lit = true }]
              }
            }
          }
        }
      }

      prepare {
        binding "retrieve_ready" {
          from_action  = "retrieve_ready"
        }
      }

      action = "retrieve"
    }

    next {
      compute {
        condition = "always"
        prog "to_draft_direct" {
          binding "always" {
            type  = "bool"
            value = true
          }
        }
      }

      action = "draft_direct"
    }
  }

  action "retrieve" {
    compute {
      root = "context_str"
      prog "retrieve_prog" {
        binding "doc_hint" {
          type  = "str"
          value = ""
        }
        binding "prefix" {
          type  = "str"
          value = "Retrieved: "
        }
        binding "context_str" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "prefix" }, { ref = "doc_hint" }]
            }
          }
        }
      }
    }

    prepare {
      binding "doc_hint" {
        from_state = "request.doc_hint"
      }
    }

    merge {
      binding "context_str" {
        to_state = "workflow.context"
      }
    }

    next {
      compute {
        condition = "always"
        prog "to_draft_with_ctx" {
          binding "always" {
            type  = "bool"
            value = true
          }
        }
      }

      action = "draft_with_context"
    }
  }

  action "draft_direct" {
    compute {
      root = "draft_text"
      prog "draft_direct_prog" {
        binding "query" {
          type  = "str"
          value = ""
        }
        binding "prefix" {
          type  = "str"
          value = "Direct answer: "
        }
        binding "draft_text" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "prefix" }, { ref = "query" }]
            }
          }
        }
      }
    }

    prepare {
      binding "query" {
        from_state = "request.query"
      }
    }

    merge {
      binding "draft_text" {
        to_state = "workflow.draft"
      }
    }

    next {
      compute {
        condition = "always"
        prog "to_safety" {
          binding "always" {
            type  = "bool"
            value = true
          }
        }
      }

      action = "safety_check"
    }
  }

  action "draft_with_context" {
    compute {
      root = "draft_text"
      prog "draft_ctx_prog" {
        binding "query" {
          type  = "str"
          value = ""
        }
        binding "context" {
          type  = "str"
          value = ""
        }
        binding "sep" {
          type  = "str"
          value = " [ctx:"
        }
        binding "close" {
          type  = "str"
          value = "]"
        }
        binding "mid" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "query" }, { ref = "sep" }]
            }
          }
        }
        binding "mid2" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "mid" }, { ref = "context" }]
            }
          }
        }
        binding "draft_text" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "mid2" }, { ref = "close" }]
            }
          }
        }
      }
    }

    prepare {
      binding "query" {
        from_state = "request.query"
      }
      binding "context" {
        from_state = "workflow.context"
      }
    }

    merge {
      binding "draft_text" {
        to_state = "workflow.draft"
      }
    }

    next {
      compute {
        condition = "always"
        prog "to_safety2" {
          binding "always" {
            type  = "bool"
            value = true
          }
        }
      }

      action = "safety_check"
    }
  }

  action "safety_check" {
    compute {
      root = "safe"
      prog "safety_prog" {
        binding "toxicity" {
          type  = "number"
          value = 0
        }
        binding "threshold" {
          type  = "number"
          value = 3
        }
        binding "safe" {
          type  = "bool"
          expr  = {
            combine = {
              fn   = "lte"
              args = [{ ref = "toxicity" }, { ref = "threshold" }]
            }
          }
        }
      }
    }

    prepare {
      binding "toxicity" {
        from_state = "request.toxicity_score"
      }
    }

    next {
      compute {
        condition = "go_publish"
        prog "to_publish" {
          binding "safe" {
            type  = "bool"
            value = false
          }
          binding "go_publish" {
            type  = "bool"
            expr  = {
              combine = {
                fn   = "bool_and"
                args = [{ ref = "safe" }, { lit = true }]
              }
            }
          }
        }
      }

      prepare {
        binding "safe" {
          from_action  = "safe"
        }
      }

      action = "publish"
    }

    next {
      compute {
        condition = "always"
        prog "to_review" {
          binding "always" {
            type  = "bool"
            value = true
          }
        }
      }

      action = "human_review"
    }
  }

  action "publish" {
    compute {
      root = "final_response"
      prog "publish_prog" {
        binding "draft" {
          type  = "str"
          value = ""
        }
        binding "final_response" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "draft" }, { lit = "" }]
            }
          }
        }
        binding "status" {
          type  = "str"
          value = "sent"
        }
      }
    }

    prepare {
      binding "draft" {
        from_state = "workflow.draft"
      }
    }

    merge {
      binding "final_response" {
        to_state = "response.last"
      }
      binding "status" {
        to_state = "workflow.status"
      }
    }
  }

  action "human_review" {
    compute {
      root = "review_note"
      prog "review_prog" {
        binding "draft" {
          type  = "str"
          value = ""
        }
        binding "prefix" {
          type  = "str"
          value = "Review needed: "
        }
        binding "review_note" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "prefix" }, { ref = "draft" }]
            }
          }
        }
        binding "status" {
          type  = "str"
          value = "awaiting_human"
        }
      }
    }

    prepare {
      binding "draft" {
        from_state = "workflow.draft"
      }
    }

    merge {
      binding "review_note" {
        to_state = "review.note"
      }
      binding "status" {
        to_state = "workflow.status"
      }
    }
  }
}
