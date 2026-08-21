# ===========================================================================
# 04 — Sensor calibration
# ===========================================================================

state {
  sensor {
    raw_readings:arr<number>  = []
    labels:arr<str>           = []
    flags:arr<bool>           = []
    serial:str                = ""
    drift_ppm:number          = 0
    ambient_c:number          = 0
  }
  calibration {
    score:number    = 0
    checksum:number = 0
    band:str        = ""
    report:str      = ""
    within_tolerance:bool = false
    needs_service:bool    = false
    logged:bool           = false
  }
}

scene "calibration_rig" {
  entry_action = evaluate_array

  overview at_least {
    evaluate_array |-> file_report |-> schedule_service
  }

  action "evaluate_array" {
    """
    Score the sensor array and decide whether it is still in tolerance.
    """

    compute "evaluate_graph" {
      raw_readings:arr<number>  <~ @sensor.raw_readings
      labels:arr<str>           <~ @sensor.labels
      flags:arr<bool>           <~ @sensor.flags
      serial:str                <~ @sensor.serial
      drift_ppm:number          <~ @sensor.drift_ppm
      ambient_c:number          <~ @sensor.ambient_c

      compensated:number = drift_ppm - ambient_c * 2
      halved:number      = compensated / 2
      remainder:number   = drift_ppm % 10

      magnitude:number = drift_ppm.abs()
      floored:number   = halved.floor()
      rounded:number   = halved.round()
      ceiling:number   = halved.ceil()
      inverted:number  = compensated.negate()

      reading_count:number = raw_readings.length()
      label_count:number   = labels.length()
      no_flags:bool        = flags.isEmpty()

      serial_len:number    = serial.length()
      serial_tag:str       = serial.trim().toUpperCase()
      serial_number:number = serial.toNumber()

      capped:number     = min(magnitude, 500)
      floored_at:number = max(capped, 0)
      spread:number     = max(reading_count, label_count)

      has_prefix:bool   = str_starts(serial_tag, "CAL")
      has_suffix:bool   = str_ends(serial_tag, "-B")
      mentions_rev:bool = str_includes(serial_tag, "REV")

      first_reading:number  = arr_get(raw_readings, 0)
      has_zero:bool         = arr_includes(raw_readings, 0)
      all_labels:arr<str>   = arr_concat(labels, labels)
      all_label_count:number = all_labels.length()

      exactly_one_marker:bool = bool_xor(has_prefix, has_suffix)

      normalized:number = first_reading
        |> max(#it, 0)
        |> min(#it, 1000)

      severe_level:bool   = capped >= 400
      elevated_level:bool = capped >= 150

      band:str = case(
        (severe_level, elevated_level),
        (true, _) -> "severe",
        (_, true) -> "elevated",
        _         -> "nominal"
      )

      array_note:str = case(
        reading_count,
        n if n >= 8 -> "full array",
        _           -> "partial array"
      )

      label_note:str = if(no_flags, "clean", "flagged")

      (band)        ~> @calibration.band
      (floored_at)  ~> @calibration.score
      (serial_tag + " " + label_note + " " + array_note) ~> @calibration.report

      checksum:number = floored + rounded + ceiling + inverted + remainder + normalized + spread + all_label_count + serial_len + serial_number
      (checksum) ~> @calibration.checksum
      in_tolerance:bool = capped < 150 & has_zero == false
      
      (in_tolerance & exactly_one_marker == false | mentions_rev) ~> @calibration.within_tolerance
    }

    next {
      compute "to_report" {
        band:str    <~ action(band)
        nominal:str <~ "nominal"
        go:bool := band != nominal
      }
      action = file_report
    }
  }

  action "file_report" {
    """
    Write the calibration record, then decide whether a technician is needed.
    """
    compute "file_report_graph" {
      band:str      <~ @calibration.band
      score:number  <~ @calibration.score

      line:str = (band + " @ " + score.toStr()) ~> @calibration.report
      (true) ~> @calibration.logged
    }

    next {
      compute "to_service" {
        score:number          <~ action(score)
        service_floor:number  <~ 400
        go:bool := score >= service_floor
      }
      action = schedule_service
    }
  }

  action "schedule_service" {
    """
    Terminal: the array has drifted far enough to need a technician.
    """
    compute "schedule_service_graph" {
      serial:str                        <~ @sensor.serial
      (serial + " queued for service")  ~> @calibration.report
      (true)                            ~> @calibration.needs_service
    }
  }
}
