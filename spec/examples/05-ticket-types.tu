# ===========================================================================
# 05 — Support ticket references, with literal and template types
#
# A helpdesk mints structured ticket references and routes on their parts.
# The point of the type system here is that a reference is not a `str` that
# happens to look right — it is a `TicketRef`, and the converter can decode
# it, refine it in a pattern, and prove a match is exhaustive.
#
# Covers: top-level `type` declarations, literal unions, the `integer`
# primitive, template literal types with typed captures, construction by
# type name, and template patterns in `case` — including capture binding
# and refinement by a literal.
# ===========================================================================

# A literal union: the only inhabitants of Queue are these three strings.
# Because the set is finite, a case over it can be proved exhaustive.
type Queue = "billing" | "technical" | "account"

# A boolean union, spelled out. Equivalent to `bool`, but naming it documents
# what the flag means at every use site.
type Escalated = true | false

# A template literal type. Each `{name: Type}` is a capture — a typed hole in
# an otherwise fixed string. `integer` is a type-system primitive that narrows
# `number` to whole values.
type TicketRef = "TKT-{queue: Queue}-{serial: integer}"

state {
  helpdesk {
    last_serial:number = 0
    open_tickets:number = 0
  }
  routing {
    queue:str = ""
    reference:str = ""
    assignee:str = ""
    priority:number = 0
  }
}

scene "ticket_intake" {
  entry_action = mint_reference

  overview at_least {
    mint_reference |=> assign_specialist
    mint_reference |=> assign_generalist
  }

  action "mint_reference" {
    """
    Mint a ticket reference from the queue and the next serial, then decide
    who picks it up by matching on the reference's own structure.
    """

    compute "mint_graph" {
      last_serial:number <~ @helpdesk.last_serial
      open_tickets:number <~ @helpdesk.open_tickets

      # A binding may be annotated with a named type rather than a primitive.
      # The value must be an inhabitant of that type — "shipping" would be
      # rejected here, at conversion time.
      queue: Queue = "technical"
      escalated: Escalated = true

      # `integer` narrows number to whole values.
      serial: integer = last_serial + 1

      # Construction by type name. Every capture must be supplied, and each
      # value must satisfy the declared type of that capture. This lowers to the
      # decoded string "TKT-technical-4471" without any string reparsing.
      reference: TicketRef = TicketRef {
        queue = queue
        serial = serial
      }

      # A template pattern decodes the reference and binds its captures. A
      # capture written bare binds to its own name; `queue: "billing"` instead
      # REFINES the capture to a literal, so that arm matches only billing
      # references.
      #
      # The subject is a tuple, so each arm pairs a reference shape with the
      # escalation flag. Both components are finite — Queue has three members,
      # Escalated has two — so the converter can check this covers every case.
      assignee:str = case(
        (reference, escalated),
        (TicketRef { queue: "billing", serial }, _) => "billing_desk",
        (TicketRef { queue: "technical", serial }, true) => "sre_oncall",
        (TicketRef { queue: "technical", serial }, false) => "support_tier2",
        (TicketRef { queue: "account", serial }, _) => "account_manager"
      )

      (assignee) ~> @routing.assignee
      (queue) ~> @routing.queue
      (serial) ~> @helpdesk.last_serial
      (open_tickets + 1) ~> @helpdesk.open_tickets

      (reference) ~> @routing.reference
    }

    # The queue is a three-member union, so every arm below names a real
    # inhabitant and the `_` arm covers the escalation axis.
    next on (queue, escalated) match {
      ("technical", true)  => assign_specialist,
      ("billing",   _)     => assign_generalist,
      ("account",   _)     => assign_generalist,
      _ => assign_generalist
    }
  }

  action "assign_specialist" {
    """
    Terminal: an escalated technical ticket goes to the on-call rota.
    """
    compute "specialist_graph" {
      # `assignee` is read back out to STATE unchanged, which is what a
      # bidirectional binding is for — see the generalist action below.
      assignee:str <~ @routing.assignee ~> @routing.assignee

      (1) ~> @routing.priority
    }
  }

  action "assign_generalist" {
    """
    Terminal: everything else goes to the shared queue.
    """
    compute "generalist_graph" {
      # Both arrows on one line: read this field, and write it back. The arrow
      # always points at the destination, so `<~` is input and `~>` output.
      assignee:str <~ @routing.assignee ~> @routing.assignee

      (3) ~> @routing.priority
    }
  }
}
