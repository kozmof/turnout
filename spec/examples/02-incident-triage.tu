# ===========================================================================
# 02 — Incident triage
# ===========================================================================

state {
  incident {
    severity:number           = 0
    affected_services:number  = 0
    customer_facing:bool      = false
    summary:str               = ""
  }
  triage {
    tier:str    = ""
    blast:str   = ""
    owner:str   = ""
    paged:bool  = false
    note:str    = ""
    escalations:number = 0
  }
}

scene "incident_response" {
  entry_action = classify_incident

  overview at_least {
    classify_incident |=> page_leadership
    classify_incident |=> page_oncall
    classify_incident |=> watch_only
    page_oncall       |=> open_ticket
    watch_only        |=> open_ticket
    watch_only        |=> watch_only_end
  }

  action "classify_incident" {
    """
    Bucket the incident on two axes — how bad it is, and how far it reaches —
    then pick a response lane from those buckets and whether customers can see
    it.
    """

    compute "classify_graph" {
      severity:number           <~ @incident.severity
      affected_services:number  <~ @incident.affected_services
      customer_facing:bool      <~ @incident.customer_facing
      oncall_owner:str          <~ hook("oncall_roster")

      critical:bool = severity >= 8
      major:bool    = severity >= 5

      tier:str = case(
        (critical, major),
        (true, _) => "critical",
        (_, true) => "major",
        _ => "minor"
      )

      widespread:bool = affected_services >= 3
      blast:str       = if(widespread, "wide", "contained")

      (tier)          ~> @triage.tier
      (blast)         ~> @triage.blast
      (oncall_owner)  ~> @triage.owner

      (true) ~> @triage.paged
    }

    publish {
      hook = "incident_timeline"
      hook = "metrics"
    }

    next on (tier, blast, customer_facing) to {
      ("critical", "wide",      true)  => page_leadership,
      ("critical", "contained", true)  => page_oncall,
      ("critical", _,           false) => page_oncall,
      ("major",    "wide",      true)  => page_oncall,
      _ => watch_only
    }

    # The first arm above is shorthand for exactly this:
    #
    #   next {
    #     compute "..." {
    #       tier:str             <~ action(tier)
    #       blast:str            <~ action(blast)
    #       customer_facing:bool <~ action(customer_facing)
    #       go:bool := tier == "critical" & blast == "wide" & customer_facing == true
    #     }
    #     action = page_leadership
    #   }
    #
    # ...and the `_` arm for the bare `next watch_only`.
  }

  action "page_oncall" {
    """
    Wake the on-call engineer, then file a follow-up ticket if the incident is
    severe enough to need a written record.
    """
    compute "page_oncall_graph" {
      owner:str           <~ @triage.owner
      severity:number     <~ @incident.severity
      ("paged " + owner)  ~> @triage.note
    }
    publish {
      hook = "pager"
    }

    next {
      compute "to_ticket" {
        severity:number     <~ action(severity)     # from the compute above
        ticket_floor:number <~ 6                    # a literal
        paged:bool          <~ @triage.paged        # post-merge STATE
        go:bool := severity >= ticket_floor & paged
      }
      action = open_ticket
    }
  }

  action "page_leadership" {
    """
    Terminal: a wide, customer-visible outage also wakes the incident
    commander.
    """
    compute "page_leadership_graph" {
      owner:str           <~ @triage.owner
      escalations:number  <~ @triage.escalations
      (escalations + 1)   ~> @triage.escalations
      ("paged " + owner + " and leadership") ~> @triage.note
    }
    publish {
      hook = "pager"
      hook = "exec_bridge"
    }
  }

  action "watch_only" {
    """
    Nothing matched a paging lane. Keep an eye on it, and file a ticket if
    it has grown since it was first reported.
    """
    compute "watch_graph" {
      affected_services:number <~ @incident.affected_services
      spreading:bool = affected_services >= 2
      trend:str = if(spreading, "spreading", "steady")

      (trend) ~> @triage.note
      (true)  ~> @triage.paged
    }

    next on trend to {
      "spreading" => open_ticket,
      _           => watch_only_end
    }
  }

  action "open_ticket" {
    """
    Terminal: no page, but somebody should look at this during business hours.
    """
    compute "open_ticket_graph" {
      tier:str  <~ @triage.tier
      blast:str <~ @triage.blast
      ("ticket: " + tier + "/" + blast) ~> @triage.note
    }
    publish {
      hook = "ticket_tracker"
    }
  }

  action "watch_only_end" {
    """
    Terminal: logged and left alone.
    """
    compute "watch_end_graph" {
      ("monitoring") ~> @triage.note
    }
  }
}
