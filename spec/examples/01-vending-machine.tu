# ===========================================================================
# 01 — Vending machine
#
# The smallest complete Turn program: one scene, four actions, one decision.
# Start here.
#
# Covers: inline STATE input (`<~ @ns.field`), named and anonymous output
# (`~> @ns.field`), the `:=` compute result and the trailing write that stands in
# for it, docstring text, the guarded transition sugar `next <flag> -> <action>`,
# and a strict overview.
# ===========================================================================

state {
  machine {
    stock_count:number = 0
    coin_balance:number = 0
    dispensed:bool = false
    message:str = ""
  }
  selection {
    slot:str = ""
    price:number = 0
  }
}

scene "vend" {
  entry_action = check_availability

  # `strict` pins the graph exactly: every node and edge below must exist in
  # the implementation, and every implemented one must appear here. A terminal
  # action is declared as a bare node with no outgoing edge.
  overview strict {
    check_availability |=> dispense
    check_availability |=> refuse
    dispense |=> thank_customer
    refuse
    thank_customer
  }

  action "check_availability" {
    """
    Decide whether the machine can serve this selection: it needs stock on the
    shelf and at least the sticker price in deposited coins.
    """

    compute "availability_graph" {
      stock_count:number <~ @machine.stock_count
      coin_balance:number <~ @machine.coin_balance
      price:number <~ @selection.price

      in_stock:bool = stock_count > 0
      paid:bool     = coin_balance >= price

      # A named output: the binding keeps its name so a transition can read it
      # back, and its value is also written to STATE. That name is why this
      # result is written out in full — `next can_vend -> dispense` below needs
      # something to point at. Compare `dispense`, whose result nothing reads.
      can_vend:bool := (in_stock & paid) ~> @machine.dispensed
    }

    # Guard first, so the line reads in evaluation order. `can_vend` must be a
    # plain bool binding from the compute block of this same action.
    next can_vend -> dispense

    # No condition at all: the fallthrough, taken when the guard above is false.
    next refuse
  }

  action "dispense" {
    """
    Release the item, take payment, and hand back any change.
    """

    compute "dispense_graph" {
      stock_count:number <~ @machine.stock_count
      coin_balance:number <~ @machine.coin_balance
      price:number <~ @selection.price

      # Anonymous outputs: write-only, so they need no binding name. Their type
      # is inferred from the STATE field they target.
      (stock_count - 1) ~> @machine.stock_count
      (coin_balance - price) ~> @machine.coin_balance

      # The last one is also the result of this action. A block with no `:=` at all
      # promotes its trailing write, so this line means
      # `__result:bool := (true) ~> @machine.dispensed` — worth spelling out only
      # when something reads the result by name, as `check_availability` above
      # does. Everything before the last line reads as setup; the last line
      # reads as a return.
      (true) ~> @machine.dispensed
    }

    next thank_customer
  }

  action "refuse" {
    """
    Terminal: explain why nothing came out.
    """

    compute "refuse_graph" {
      stock_count:number <~ @machine.stock_count

      sold_out:bool = stock_count == 0

      (if(sold_out, "sold out", "insufficient payment")) ~> @machine.message
    }
  }

  action "thank_customer" {
    """
    Terminal: acknowledge the sale.
    """

    compute "thanks_graph" {
      slot:str <~ @selection.slot

      ("enjoy your " + slot) ~> @machine.message
    }
  }
}
