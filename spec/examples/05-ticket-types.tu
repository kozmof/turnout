# ===========================================================================
# 05 — Support ticket references, with literal and template types
# ===========================================================================

type Queue = "billing" | "technical" | "account"
type Escalated = true | false
type TicketRef = "TKT-{queue: Queue}-{serial: integer}"

state {
  helpdesk {
    last_serial:number  = 0
    open_tickets:number = 0
  }
  routing {
    queue:str       = ""
    reference:str   = ""
    assignee:str    = ""
    priority:number = 0
  }
}

scene "ticket_intake" {
  entry_action = mint_reference

  overview at_least {
    mint_reference |-> assign_specialist
    mint_reference |-> assign_generalist
  }

  action "mint_reference" {
    """
    Mint a ticket reference from the queue and the next serial, then decide
    who picks it up by matching on the reference's own structure.
    """

    compute "mint_graph" {
      last_serial:number  <~ @helpdesk.last_serial
      open_tickets:number <~ @helpdesk.open_tickets

      queue: Queue          = "technical"
      escalated: Escalated  = true
      serial: integer       = last_serial + 1

      reference: TicketRef = TicketRef {
        queue = queue
        serial = serial
      }

      assignee:str = case(
        (reference, escalated),
        (TicketRef { queue: "billing", serial }, _) -> "billing_desk",
        (TicketRef { queue: "technical", serial }, true) -> "sre_oncall",
        (TicketRef { queue: "technical", serial }, false) -> "support_tier2",
        (TicketRef { queue: "account", serial }, _) -> "account_manager"
      )

      (assignee)          ~> @routing.assignee
      (queue)             ~> @routing.queue
      (serial)            ~> @helpdesk.last_serial
      (open_tickets + 1)  ~> @helpdesk.open_tickets
      (reference)         ~> @routing.reference
    }

    next on (queue, escalated) to {
      ("technical", true)  -> assign_specialist,
      ("billing",   _)     -> assign_generalist,
      ("account",   _)     -> assign_generalist,
      _                    -> assign_generalist
    }
  }

  action "assign_specialist" {
    """
    Terminal: an escalated technical ticket goes to the on-call rota.
    """
    compute "specialist_graph" {
      assignee:str <~ @routing.assignee ~> @routing.assignee
      (1)                               ~> @routing.priority
    }
  }

  action "assign_generalist" {
    """
    Terminal: everything else goes to the shared queue.
    """
    compute "generalist_graph" {
      assignee:str <~ @routing.assignee ~> @routing.assignee
      (3)                               ~> @routing.priority
    }
  }
}
