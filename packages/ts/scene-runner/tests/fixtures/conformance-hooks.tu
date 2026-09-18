# ===========================================================================
# Conformance: hooks
# ===========================================================================
#
# The model behind the host conformance vectors that cover hooks: one prepare
# hook supplying two bindings, a publish hook, and a second action so stepping
# order is observable.

state {
  job {
    seed:number     = 0
    width:number    = 0
    height:number   = 0
    area:number     = 0
    reported:number = 0
  }
}

scene "measure" {
  entry_action = size

  action "size" {
    compute "size_graph" {
      seed:number <~ @job.seed

      width:number  <~ hook("load_dimensions")
      height:number <~ hook("load_dimensions")

      area:number := (seed + width * height) ~> @job.area
    }

    publish {
      hook = "report_area"
    }

    next record
  }

  action "record" {
    compute "record_graph" {
      area:number <~ @job.area

      reported:number := (area) ~> @job.reported
    }
  }
}
