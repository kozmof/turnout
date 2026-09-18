# ===========================================================================
# Prepare-hook context
# ===========================================================================
#
# What a prepare hook can read: the action's `from_state` bindings, and the
# values hooks earlier in the same action returned. The runtime resolves both
# against the model and STATE it holds, and hands them over with the request.

state {
  order {
    subtotal:number = 0
    discount:number = 0
    total:number    = 0
    settled:number  = 0
  }
}

scene "checkout" {
  entry_action = price

  action "price" {
    compute "price_graph" {
      subtotal:number <~ @order.subtotal
      discount:number <~ @order.discount

      shipping:number <~ hook("quote_shipping")
      tax:number      <~ hook("quote_tax")

      total:number := (subtotal - discount + shipping + tax) ~> @order.total
    }

    next settle
  }

  action "settle" {
    compute "settle_graph" {
      total:number <~ @order.total

      settled:number := (total * 2) ~> @order.settled
    }
  }
}
