state {
  applicant {
    income:number = 0
    debt:number   = 0
  }
  decision {
    approved:bool        = false
    input_income:number  = 0
    status:str           = ""
    code:str             = ""
    reason:str           = ""
  }
}
scene "loan_flow" {
  entry_action     = score

  overview at_least {
    score |-> approve
    score |-> reject
  }

  action "score" {
    """
    Logic overview:
    - Read income and debt from STATE into compute inputs.
    - Evaluate threshold checks and derive `decision`.
    - Persist approval flag and input snapshot to STATE.
    - Route to `approve` when decision path is true; otherwise fall through to `reject`.
    """

    compute "score_graph" {
      income:number <~ @applicant.income ~> @decision.input_income
      debt:number <~ @applicant.debt
      min_income:number = 50000
      max_debt:number   = 20000

      income_ok:bool = income >= min_income
      debt_ok:bool = debt <= max_debt
      decision:bool := (income_ok & debt_ok) ~> @decision.approved
    }

    next {
      compute "to_approve" {
        decision:bool <~ action(decision)
        income_ok:bool <~ action(income_ok)
        go:bool := decision & income_ok
      }
      action = approve
    }

    next {
      action = reject
    }
  }

  action "approve" {
    """
    Logic overview:
    - Build a deterministic approval code from a fixed prefix/suffix pair.
    - Mark decision status as approved and store the generated code.
    """

    compute "approve_graph" {
      prefix:str = "APR-"
      suffix:str = "0001"
      status:str = ("approved") ~> @decision.status
      approval_code:str := (prefix + suffix) ~> @decision.code
    }

  }

  action "reject" {
    """
    Logic overview:
    - Produce a deterministic rejection reason.
    - Mark decision status as rejected and persist the rejection reason.
    """

    compute "reject_graph" {
      status:str = ("rejected") ~> @decision.status
      reason:str := ("risk_threshold_not_met") ~> @decision.reason
    }

  }
}
