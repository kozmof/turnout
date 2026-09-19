# The lane a `extend` hook brings in, compiled on its own.
#
# It declares the same `cart` namespace as the base model, identically. Two
# scene sets that both need a field will both declare it, and declaring it the
# same way twice is agreement rather than a collision.

state {
  cart {
    item_count:number = 0
    is_return:bool    = false
    lane:str          = ""
  }
}

scene "checkout" {
  entry_action = take_payment

  action "take_payment" {
    compute "payment_graph" {
      item_count:number <~ @cart.item_count

      total:number := (item_count * 10) ~> @cart.item_count
    }
  }
}
