state {
  applicant {
    age:number = 0
    is_resident:bool = false
    sanctioned:bool = false
    credit_score:number = 0
    fraud_flag:bool = false
  }
  intake {
    eligible:bool = false
    passed:bool = false
  }
  workflow {
    phase:str = ""
    reject_reason:str = ""
    account_ref:str = ""
    outcome:str = ""
    rejection_notice:str = ""
  }
  documents {
    expired:bool = false
    ocr_confidence:number = 0
    review_passed:bool = false
    verified:bool = false
  }
  risk {
    score:number = 0
    tier:str = ""
    decision:str = ""
    needs_review:bool = false
  }
  review {
    reviewer_decision:str = ""
    reviewer_confidence:number = 0
    approved:bool = false
    outcome:str = ""
  }
}

# Multi-scene example: Customer Onboarding Flow
#
# Route: onboarding_flow
#   intake  -->  document_review  -->  risk_assessment  -->  approved
#                                  \                    \-->  manual_review  -->  approved
#                                   \                                        \-->  rejected
#                \-->  rejected (early reject)
#                                   \-->  rejected (docs invalid)
#                                                       \-->  rejected (high risk)
#
# STATE is shared across all scenes in the route.
# Route history accumulates: intake.*, document_review.*, risk_assessment.*, etc.

# ---------------------------------------------------------------------------
# Scene 1: intake
# Entry point. Collects applicant data, decides proceed or early reject.
# ---------------------------------------------------------------------------

scene "intake" {
  entry_actions = [collect_info]
  next_policy   = "first-match"

  overview at_least {
    collect_info |=> proceed
    collect_info |=> early_reject
  }

  action "collect_info" {
    """
    Logic overview:
    - Read applicant age, residency flag, and sanction-list hit from STATE.
    - Determine whether the applicant clears the minimum entry bar.
    - Branch to `proceed` when eligible; fall through to `early_reject`.
    """

    compute {
      prog "collect_info_graph" {
        age:number <~ @applicant.age
        is_resident:bool <~ @applicant.is_resident
        sanctioned:bool <~ @applicant.sanctioned

        age_ok:bool       = age >= 18
        not_sanctioned:bool = sanctioned == false
        residency_ok:bool = age_ok & is_resident
        phase:str = ("intake_collect_info") ~> @workflow.phase
        |^| eligible:bool = (residency_ok & not_sanctioned) ~> @intake.eligible
      }
    }

    next {
      compute {
        prog "to_proceed" {
          eligible:bool <~ action(eligible)
          |?| go_proceed:bool = eligible
        }
      }
      action = proceed
    }

    next {
      action = early_reject
    }
  }

  action "proceed" {
    """
    Logic overview:
    - Mark intake as passed and stamp the transition phase.
    - No next actions — scene terminates here, routing hands off to the route match block.
    """

    compute {
      prog "proceed_graph" {
        intake_passed:bool = (true) ~> @intake.passed
        |^| phase:str = ("intake_proceed") ~> @workflow.phase
      }
    }

  }

  action "early_reject" {
    """
    Logic overview:
    - Record the rejection reason and mark intake as failed.
    - No next actions — scene terminates here.
    """

    compute {
      prog "early_reject_graph" {
        reject_reason:str = ("failed_intake_eligibility") ~> @workflow.reject_reason
        intake_passed:bool = (false) ~> @intake.passed
        |^| phase:str = ("intake_early_reject") ~> @workflow.phase
      }
    }

  }
}

# ---------------------------------------------------------------------------
# Scene 2: document_review
# Validates submitted identity documents.
# ---------------------------------------------------------------------------

scene "document_review" {
  entry_actions = [check_documents]
  next_policy   = "first-match"

  overview at_least {
    check_documents |=> mark_valid
    check_documents |=> mark_invalid
  }

  action "check_documents" {
    """
    Logic overview:
    - Read document expiry status and OCR confidence score from STATE.
    - Determine whether documents pass the quality threshold.
    - Branch to mark_valid or mark_invalid.
    """

    compute {
      prog "check_documents_graph" {
        doc_expired:bool <~ @documents.expired
        ocr_confidence:number <~ @documents.ocr_confidence

        not_expired:bool    = doc_expired == false
        ocr_ok:bool         = ocr_confidence >= 80
        phase:str = ("document_review_check") ~> @workflow.phase
        |^| docs_ok:bool = (not_expired & ocr_ok) ~> @documents.review_passed
      }
    }

    next {
      compute {
        prog "to_mark_valid" {
          docs_ok:bool <~ action(docs_ok)
          |?| go_valid:bool  = docs_ok
        }
      }
      action = mark_valid
    }

    next {
      action = mark_invalid
    }
  }

  action "mark_valid" {
    """
    Logic overview:
    - Stamp documents as verified and record the verification phase.
    - Terminal action — scene ends here.
    """

    compute {
      prog "mark_valid_graph" {
        docs_verified:bool = (true) ~> @documents.verified
        |^| phase:str = ("document_review_mark_valid") ~> @workflow.phase
      }
    }

  }

  action "mark_invalid" {
    """
    Logic overview:
    - Stamp documents as unverified, record a rejection reason.
    - Terminal action — scene ends here.
    """

    compute {
      prog "mark_invalid_graph" {
        docs_verified:bool = (false) ~> @documents.verified
        reject_reason:str = ("document_validation_failed") ~> @workflow.reject_reason
        |^| phase:str = ("document_review_mark_invalid") ~> @workflow.phase
      }
    }

  }
}

# ---------------------------------------------------------------------------
# Scene 3: risk_assessment
# Scores the applicant and branches to low / high / borderline outcomes.
# ---------------------------------------------------------------------------

scene "risk_assessment" {
  entry_actions = [score_risk]
  next_policy   = "first-match"

  overview at_least {
    score_risk |=> low_risk_pass
    score_risk |=> high_risk_fail
    score_risk |=> borderline_flag
  }

  action "score_risk" {
    """
    Logic overview:
    - Read credit score and fraud flag from STATE.
    - Derive risk tier: low, high, or borderline.
    - Branch on tier.
    """

    compute {
      prog "score_risk_graph" {
        credit_score:number <~ @applicant.credit_score
        fraud_flag:bool <~ @applicant.fraud_flag

        risk_score:number = (credit_score) ~> @risk.score
        phase:str = ("risk_assessment_score") ~> @workflow.phase
        |^| risk_tier:str = (if(
          fraud_flag,
          "high",
          if(
            credit_score >= 700,
            "low",
            if(credit_score < 500, "high", "borderline")
          )
        )) ~> @risk.tier
      }
    }

    next {
      compute {
        prog "to_low_risk" {
          risk_tier:str <~ action(risk_tier)
          |?| go_low:bool     = risk_tier == "low"
        }
      }
      action = low_risk_pass
    }

    next {
      compute {
        prog "to_high_risk" {
          risk_tier:str <~ action(risk_tier)
          |?| go_high:bool    = risk_tier == "high"
        }
      }
      action = high_risk_fail
    }

    next {
      action = borderline_flag
    }
  }

  action "low_risk_pass" {
    """
    Logic overview:
    - Record final risk decision as low and mark assessment complete.
    - Terminal action — scene ends here.
    """

    compute {
      prog "low_risk_pass_graph" {
        risk_decision:str = ("low_risk_approved") ~> @risk.decision
        |^| phase:str = ("risk_assessment_low_risk_pass") ~> @workflow.phase
      }
    }

  }

  action "high_risk_fail" {
    """
    Logic overview:
    - Record final risk decision as high risk and stamp rejection reason.
    - Terminal action — scene ends here.
    """

    compute {
      prog "high_risk_fail_graph" {
        risk_decision:str = ("high_risk_rejected") ~> @risk.decision
        reject_reason:str = ("risk_score_too_high") ~> @workflow.reject_reason
        |^| phase:str = ("risk_assessment_high_risk_fail") ~> @workflow.phase
      }
    }

  }

  action "borderline_flag" {
    """
    Logic overview:
    - Flag the case for manual review and record the borderline decision.
    - Terminal action — scene ends here.
    """

    compute {
      prog "borderline_flag_graph" {
        risk_decision:str = ("borderline_manual_review") ~> @risk.decision
        needs_review:bool = (true) ~> @risk.needs_review
        |^| phase:str = ("risk_assessment_borderline_flag") ~> @workflow.phase
      }
    }

  }
}

# ---------------------------------------------------------------------------
# Scene 4: manual_review
# A human reviewer approves or rejects a borderline application.
# ---------------------------------------------------------------------------

scene "manual_review" {
  entry_actions = [assign_reviewer]
  next_policy   = "first-match"

  overview at_least {
    assign_reviewer |=> override_approve
    assign_reviewer |=> override_reject
  }

  action "assign_reviewer" {
    """
    Logic overview:
    - Read reviewer decision and confidence from STATE (written by an external hook).
    - Branch on reviewer outcome.
    """

    compute {
      prog "assign_reviewer_graph" {
        reviewer_decision:str <~ @review.reviewer_decision
        reviewer_confidence:number <~ @review.reviewer_confidence

        decision_ok:bool             = reviewer_confidence >= 70
        phase:str = ("manual_review_assign") ~> @workflow.phase
        |^| reviewer_approved:bool = (decision_ok) ~> @review.approved
      }
    }

    next {
      compute {
        prog "to_override_approve" {
          reviewer_approved:bool <~ action(reviewer_approved)
          |?| go_approve:bool          = reviewer_approved
        }
      }
      action = override_approve
    }

    next {
      action = override_reject
    }
  }

  action "override_approve" {
    """
    Logic overview:
    - Record that the manual reviewer approved the case.
    - Terminal action — scene ends here.
    """

    compute {
      prog "override_approve_graph" {
        review_outcome:str = ("manual_approved") ~> @review.outcome
        |^| phase:str = ("manual_review_override_approve") ~> @workflow.phase
      }
    }

  }

  action "override_reject" {
    """
    Logic overview:
    - Record that the manual reviewer rejected the case and stamp the reason.
    - Terminal action — scene ends here.
    """

    compute {
      prog "override_reject_graph" {
        review_outcome:str = ("manual_rejected") ~> @review.outcome
        reject_reason:str = ("manual_review_declined") ~> @workflow.reject_reason
        |^| phase:str = ("manual_review_override_reject") ~> @workflow.phase
      }
    }

  }
}

# ---------------------------------------------------------------------------
# Scene 5: approved
# Issues an approval decision and generates an account reference.
# ---------------------------------------------------------------------------

scene "approved" {
  entry_actions = [issue_approval]
  next_policy   = "first-match"

  action "issue_approval" {
    """
    Logic overview:
    - Generate a deterministic approval reference.
    - Mark the overall flow outcome as approved.
    - Terminal action — no next actions.
    """

    compute {
      prog "issue_approval_graph" {
        prefix:str           = "ACC-"
        suffix:str           = "APPROVED"
        flow_outcome:str = ("approved") ~> @workflow.outcome
        phase:str = ("approved_issue_approval") ~> @workflow.phase
        |^| account_ref:str = (prefix + suffix) ~> @workflow.account_ref
      }
    }

  }
}

# ---------------------------------------------------------------------------
# Scene 6: rejected
# Records a final rejection with the accumulated reject_reason from STATE.
# ---------------------------------------------------------------------------

scene "rejected" {
  entry_actions = [issue_rejection]
  next_policy   = "first-match"

  action "issue_rejection" {
    """
    Logic overview:
    - Read the reject_reason written by the preceding scene.
    - Stamp the flow outcome as rejected and emit a final notice.
    - Terminal action — no next actions.
    """

    compute {
      prog "issue_rejection_graph" {
        reject_reason:str <~ @workflow.reject_reason

        prefix:str           = "Rejected: "
        rejection_notice:str = (prefix + reject_reason) ~> @workflow.rejection_notice
        phase:str = ("rejected_issue_rejection") ~> @workflow.phase
        |^| flow_outcome:str = ("rejected") ~> @workflow.outcome
      }
    }

  }
}

# ---------------------------------------------------------------------------
# Route: onboarding_flow
#
# Evaluated each time a scene reaches a terminal state (no next action).
# STATE is not reset between scenes — flow.* and risk.* accumulate.
# History format: <scene_id>.<action_id>, grown in execution order.
#
# Priority notes:
#   - Exact terminal-action patterns (no *) beat wildcard patterns.
#   - Among wildcard patterns, declaration order breaks ties.
#   - `_` is lowest priority and handles unexpected histories.
# ---------------------------------------------------------------------------

route "onboarding_flow" {
  entry = intake
  match {
    # intake outcomes
    intake.proceed       => document_review,
    intake.early_reject  => rejected,

    # document_review outcomes
    document_review.mark_valid   => risk_assessment,
    document_review.mark_invalid => rejected,

    # risk_assessment outcomes — exact matches beat the wildcard fallback
    risk_assessment.low_risk_pass   => approved,
    risk_assessment.high_risk_fail  => rejected,
    risk_assessment.borderline_flag => manual_review,

    # manual_review outcomes
    manual_review.override_approve => approved,
    manual_review.override_reject  => rejected,

    # catch-all: any unrecognised terminal history goes to rejected
    _ => rejected
  }
}
