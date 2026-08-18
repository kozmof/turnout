# ===========================================================================
# 01 — Vending machine
# ===========================================================================

state {
  machine {
    stock_count:number  = 0
    coin_balance:number = 0
    dispensed:bool      = false
    message:str         = ""
  }
  selection {
    slot:str      = ""
    price:number  = 0
  }
}

scene "vend" {
  entry_action = check_availability

  overview strict {
    check_availability  |=> dispense
    check_availability  |=> refuse
    dispense            |=> thank_customer
    refuse
    thank_customer
  }

  action "check_availability" {
    """
    Decide whether the machine can serve this selection: it needs stock on the
    shelf and at least the sticker price in deposited coins.
    """

    compute "availability_graph" {
      stock_count:number  <~ @machine.stock_count
      coin_balance:number <~ @machine.coin_balance
      price:number        <~ @selection.price

      in_stock:bool = stock_count > 0
      paid:bool     = coin_balance >= price

      can_vend:bool := (in_stock & paid) ~> @machine.dispensed
    }

    next can_vend -> dispense
    next refuse
  }

  action "dispense" {
    """
    Release the item, take payment, and hand back any change.
    """

    compute "dispense_graph" {
      stock_count:number  <~ @machine.stock_count
      coin_balance:number <~ @machine.coin_balance
      price:number        <~ @selection.price

      (stock_count - 1)       ~> @machine.stock_count
      (coin_balance - price)  ~> @machine.coin_balance
      (true)                  ~> @machine.dispensed
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
      slot:str                <~ @selection.slot
      ("enjoy your " + slot)  ~> @machine.message
    }
  }
}
