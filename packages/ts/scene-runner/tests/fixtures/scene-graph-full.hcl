state {
  namespace "applicant" {
    field "income" {
      type  = "number"
      value = 0
    }
    field "debt" {
      type  = "number"
      value = 0
    }
  }
  namespace "decision" {
    field "approved" {
      type  = "bool"
      value = false
    }
    field "input_income" {
      type  = "number"
      value = 0
    }
    field "status" {
      type  = "str"
      value = ""
    }
    field "code" {
      type  = "str"
      value = ""
    }
    field "reason" {
      type  = "str"
      value = ""
    }
  }
}

scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  action "score" {
    text = <<-EOT
        Logic overview:
        - Read income and debt from STATE into compute inputs.
        - Evaluate threshold checks and derive `decision`.
        - Persist approval flag and input snapshot to STATE.
        - Route to `approve` when decision path is true; otherwise fall through to `reject`.
        
    EOT

    compute {
      root = "decision"
      prog "score_graph" {
        binding "income" {
          type  = "number"
          value = 0
        }
        binding "debt" {
          type  = "number"
          value = 0
        }
        binding "min_income" {
          type  = "number"
          value = 50000
        }
        binding "max_debt" {
          type  = "number"
          value = 20000
        }
        binding "income_ok" {
          type  = "bool"
          expr  = {
            combine = {
              fn   = "gte"
              args = [{ ref = "income" }, { ref = "min_income" }]
            }
          }
        }
        binding "debt_ok" {
          type  = "bool"
          expr  = {
            combine = {
              fn   = "lte"
              args = [{ ref = "debt" }, { ref = "max_debt" }]
            }
          }
        }
        binding "decision" {
          type  = "bool"
          expr  = {
            combine = {
              fn   = "bool_and"
              args = [{ ref = "income_ok" }, { ref = "debt_ok" }]
            }
          }
        }
      }
    }

    prepare {
      binding "income" {
        from_state = "applicant.income"
      }
      binding "debt" {
        from_state = "applicant.debt"
      }
    }

    merge {
      binding "income" {
        to_state = "decision.input_income"
      }
      binding "decision" {
        to_state = "decision.approved"
      }
    }

    next {
      compute {
        condition = "go"
        prog "to_approve" {
          binding "decision" {
            type  = "bool"
            value = false
          }
          binding "income_ok" {
            type  = "bool"
            value = false
          }
          binding "go" {
            type  = "bool"
            expr  = {
              combine = {
                fn   = "bool_and"
                args = [{ ref = "decision" }, { ref = "income_ok" }]
              }
            }
          }
        }
      }

      prepare {
        binding "decision" {
          from_action  = "decision"
        }
        binding "income_ok" {
          from_action  = "income_ok"
        }
      }

      action = "approve"
    }

    next {
      compute {
        condition = "always"
        prog "to_reject" {
          binding "always" {
            type  = "bool"
            value = true
          }
        }
      }

      action = "reject"
    }
  }

  action "approve" {
    text = <<-EOT
        Logic overview:
        - Build a deterministic approval code from a fixed prefix/suffix pair.
        - Mark decision status as approved and store the generated code.
        
    EOT

    compute {
      root = "approval_code"
      prog "approve_graph" {
        binding "prefix" {
          type  = "str"
          value = "APR-"
        }
        binding "suffix" {
          type  = "str"
          value = "0001"
        }
        binding "status" {
          type  = "str"
          value = "approved"
        }
        binding "approval_code" {
          type  = "str"
          expr  = {
            combine = {
              fn   = "str_concat"
              args = [{ ref = "prefix" }, { ref = "suffix" }]
            }
          }
        }
      }
    }

    merge {
      binding "status" {
        to_state = "decision.status"
      }
      binding "approval_code" {
        to_state = "decision.code"
      }
    }
  }

  action "reject" {
    text = <<-EOT
        Logic overview:
        - Produce a deterministic rejection reason.
        - Mark decision status as rejected and persist the rejection reason.
        
    EOT

    compute {
      root = "reason"
      prog "reject_graph" {
        binding "status" {
          type  = "str"
          value = "rejected"
        }
        binding "reason" {
          type  = "str"
          value = "risk_threshold_not_met"
        }
      }
    }

    merge {
      binding "status" {
        to_state = "decision.status"
      }
      binding "reason" {
        to_state = "decision.reason"
      }
    }
  }
}
