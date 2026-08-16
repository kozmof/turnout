# Payment webhook routing with literal and template types
#
# A payment service receives provider-specific webhook IDs, but stores one
# canonical event number for idempotency. Only verified webhooks advance the
# checkpoint. The provider and verification flag are finite literal unions, so
# the converter can prove that the tuple case is exhaustive.

type PaymentProvider = "stripe" | "paypal"
type VerificationStatus = true | false
type PaymentEventId = "payment-{provider: PaymentProvider}-{event_number: integer}"

state {
  payments {
    last_processed_event:number = 1041
  }
}

scene "payment_webhook" {
  entry_actions = [record_verified_event]

  action "record_verified_event" {
    compute "advance_payment_checkpoint" {
      last_processed_event:number <~ @payments.last_processed_event

      provider: PaymentProvider = "paypal"
      event_number: integer = 1042

      event_id: PaymentEventId = PaymentEventId {
        provider = provider
        event_number = event_number
      }

      verified: VerificationStatus = true

      new_checkpoint:number := (case(
        (event_id, verified),
        (PaymentEventId { event_number: _ }, false) => last_processed_event,
        (PaymentEventId { provider: "stripe", event_number }, true) => event_number,
        (PaymentEventId { provider: "paypal", event_number }, true) => event_number
      )) ~> @payments.last_processed_event
    }

  }
}
