state {
  input {
    value:number = 0
  }
  output {
    result:number = 0
  }
}

scene "scene_a" {
  entry_action = step_a

  action "step_a" {
    compute "a_prog" {
      value:number <~ @input.value
      doubled:number := (value + value) ~> @output.result
    }

  }
}

scene "scene_b" {
  entry_action = step_b

  action "step_b" {
    compute "b_prog" {
      result:number <~ @output.result
      final_val:number := (result + 1) ~> @output.result
    }

  }
}

route "main_route" {
  entry = scene_a
  match {
    scene_a.step_a => scene_b
  }
}
