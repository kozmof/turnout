scene "loan_flow" {
  entry_actions     = ["score"]
  next_policy       = "first-match"

  view "overview" {
    text = <<-EOT
      score
        |=> approve
        |=> reject
    EOT
    enforce = "at_least"
  }

  action "score" {
    compute {
      root     = decision
      prog "score_graph" {
        income:int = 0
        debt:int = 0
        min_income:int = 50000
        max_debt:int = 20000

        income_ok:bool = gte(income, min_income)
        debt_ok:bool = lte(debt, max_debt)
        decision:bool = bool_and(income_ok, debt_ok)
      }
    }

    ingress {
      to        = income
      from_ssot = applicant.income
    }

    ingress {
      to        = debt
      from_ssot = applicant.debt
    }

    egress {
      to   = decision.approved
      from = decision
    }

    egress {
      to   = decision.input_income
      from = income
    }

    next {
      compute {
        root = go
        prog "to_approve" {
          decision:bool = false
          go:bool = decision
        }
      }
      ingress {
        to          = decision
        from_action = decision
      }
      to   = approve
    }

    next {
      compute {
        root = always
        prog "to_reject" {
          always:bool = true
        }
      }
      to   = reject
    }
  }

  action "approve" {
    compute {
      root     = approval_code
      prog "approve_graph" {
        prefix:str = "APR-"
        suffix:str = "0001"
        approval_code:str = str_concat(prefix, suffix)
      }
    }

    egress {
      to           = decision.status
      from_literal = "approved"
    }

    egress {
      to   = decision.code
      from = approval_code
    }
  }

  action "reject" {
    compute {
      root     = reason
      prog "reject_graph" {
        reason:str = "risk_threshold_not_met"
      }
    }

    egress {
      to           = decision.status
      from_literal = "rejected"
    }

    egress {
      to   = decision.reason
      from = reason
    }
  }
}
