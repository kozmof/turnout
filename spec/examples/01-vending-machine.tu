# ===========================================================================
# 01 — Vending machine
#
# The smallest complete Turn program: one scene, four actions, one decision.
# Start here.
#
# Covers: inline STATE input (`<~ @ns.field`), named and anonymous output
# (`~> @ns.field`), the `:=` compute result, docstring text, the guarded
# transition sugar `next <flag> -> <action>`, and a strict overview.
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
  next_policy  = "first-match"

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
      # back, and its value is also written to STATE.
      can_vend:bool := (in_stock & paid) ~> @machine.dispensed
    }

    # Guard first, so the line reads in evaluation order. `can_vend` must be a
    # plain bool binding of this action's own compute block.
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

      released:bool := (true) ~> @machine.dispensed

      # NOTE: the := result must be the last binding in the block. Everything
      # above it reads as setup; the result reads as a return.
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

      reason:str := (if(sold_out, "sold out", "insufficient payment")) ~> @machine.message
    }
  }

  action "thank_customer" {
    """
    Terminal: acknowledge the sale.
    """

    compute "thanks_graph" {
      slot:str <~ @selection.slot

      note:str := ("enjoy your " + slot) ~> @machine.message
    }
  }
}
