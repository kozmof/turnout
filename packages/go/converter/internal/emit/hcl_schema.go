package emit

import (
	"github.com/hashicorp/hcl-lang/schema"
	"github.com/zclconf/go-cty/cty"
)

// turnoutBodySchema returns the hcl-lang BodySchema for the canonical plain
// HCL format produced by Emit. It is used by validateHCL to catch structural
// errors (unknown blocks/attributes, missing required fields, label-count
// mismatches, cardinality violations) before the decoded body is converted to
// JSON.
func turnoutBodySchema() *schema.BodySchema {
	return &schema.BodySchema{
		Blocks: map[string]*schema.BlockSchema{
			"state": stateSchema(),
			"scene": sceneSchema(),
			"route": routeSchema(),
		},
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// state { namespace "<name>" { field "<name>" { type value } } }
// ─────────────────────────────────────────────────────────────────────────────

func stateSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		MaxItems: 1,
		Body: &schema.BodySchema{
			Blocks: map[string]*schema.BlockSchema{
				"namespace": {
					Labels: []*schema.LabelSchema{{Name: "name"}},
					Body: &schema.BodySchema{
						Blocks: map[string]*schema.BlockSchema{
							"field": {
								Labels: []*schema.LabelSchema{{Name: "name"}},
								Body: &schema.BodySchema{
									Attributes: map[string]*schema.AttributeSchema{
										"type":  {IsRequired: true, Constraint: schema.LiteralType{Type: cty.String}},
										"value": {IsRequired: true, Constraint: schema.AnyExpression{OfType: cty.DynamicPseudoType}},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// scene "<id>" { ... action "<id>" { ... } }
// ─────────────────────────────────────────────────────────────────────────────

func sceneSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		Labels: []*schema.LabelSchema{{Name: "id"}},
		Body: &schema.BodySchema{
			Attributes: map[string]*schema.AttributeSchema{
				"entry_actions": {IsRequired: true, Constraint: schema.AnyExpression{OfType: cty.List(cty.String)}},
				"next_policy":   {IsOptional: true, Constraint: schema.LiteralType{Type: cty.String}},
			},
			Blocks: map[string]*schema.BlockSchema{
				"action": actionSchema(),
			},
		},
	}
}

func actionSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		Labels: []*schema.LabelSchema{{Name: "id"}},
		Body: &schema.BodySchema{
			Attributes: map[string]*schema.AttributeSchema{
				"text":    {IsOptional: true, Constraint: schema.LiteralType{Type: cty.String}},
				"publish": {IsOptional: true, Constraint: schema.AnyExpression{OfType: cty.List(cty.String)}},
			},
			Blocks: map[string]*schema.BlockSchema{
				"compute": actionComputeSchema(),
				"prepare": actionPrepareSchema(),
				"merge":   mergeSchema(),
				"next":    nextSchema(),
			},
		},
	}
}

func actionComputeSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		MaxItems: 1,
		Body: &schema.BodySchema{
			Attributes: map[string]*schema.AttributeSchema{
				"root": {IsRequired: true, Constraint: schema.LiteralType{Type: cty.String}},
			},
			Blocks: map[string]*schema.BlockSchema{
				"prog": progSchema(),
			},
		},
	}
}

func progSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		Labels: []*schema.LabelSchema{{Name: "name"}},
		Body: &schema.BodySchema{
			Blocks: map[string]*schema.BlockSchema{
				"binding": bindingSchema(),
			},
		},
	}
}

func bindingSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		Labels: []*schema.LabelSchema{{Name: "name"}},
		Body: &schema.BodySchema{
			Attributes: map[string]*schema.AttributeSchema{
				"type":  {IsRequired: true, Constraint: schema.LiteralType{Type: cty.String}},
				"value": {IsOptional: true, Constraint: schema.AnyExpression{OfType: cty.DynamicPseudoType}},
				"expr":  {IsOptional: true, Constraint: schema.AnyExpression{OfType: cty.DynamicPseudoType}},
			},
		},
	}
}

func actionPrepareSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		MaxItems: 1,
		Body: &schema.BodySchema{
			Blocks: map[string]*schema.BlockSchema{
				"binding": {
					Labels: []*schema.LabelSchema{{Name: "name"}},
					Body: &schema.BodySchema{
						Attributes: map[string]*schema.AttributeSchema{
							"from_state": {IsOptional: true, Constraint: schema.LiteralType{Type: cty.String}},
							"from_hook":  {IsOptional: true, Constraint: schema.LiteralType{Type: cty.String}},
						},
					},
				},
			},
		},
	}
}

func mergeSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		MaxItems: 1,
		Body: &schema.BodySchema{
			Blocks: map[string]*schema.BlockSchema{
				"binding": {
					Labels: []*schema.LabelSchema{{Name: "name"}},
					Body: &schema.BodySchema{
						Attributes: map[string]*schema.AttributeSchema{
							"to_state": {IsRequired: true, Constraint: schema.LiteralType{Type: cty.String}},
						},
					},
				},
			},
		},
	}
}

func nextSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		Body: &schema.BodySchema{
			Attributes: map[string]*schema.AttributeSchema{
				"action": {IsRequired: true, Constraint: schema.LiteralType{Type: cty.String}},
			},
			Blocks: map[string]*schema.BlockSchema{
				"compute": nextComputeSchema(),
				"prepare": nextPrepareSchema(),
			},
		},
	}
}

func nextComputeSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		MaxItems: 1,
		Body: &schema.BodySchema{
			Attributes: map[string]*schema.AttributeSchema{
				"condition": {IsRequired: true, Constraint: schema.LiteralType{Type: cty.String}},
			},
			Blocks: map[string]*schema.BlockSchema{
				"prog": progSchema(),
			},
		},
	}
}

func nextPrepareSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		MaxItems: 1,
		Body: &schema.BodySchema{
			Blocks: map[string]*schema.BlockSchema{
				"binding": {
					Labels: []*schema.LabelSchema{{Name: "name"}},
					Body: &schema.BodySchema{
						Attributes: map[string]*schema.AttributeSchema{
							"from_action":  {IsOptional: true, Constraint: schema.LiteralType{Type: cty.String}},
							"from_state":   {IsOptional: true, Constraint: schema.LiteralType{Type: cty.String}},
							"from_literal": {IsOptional: true, Constraint: schema.AnyExpression{OfType: cty.DynamicPseudoType}},
						},
					},
				},
			},
		},
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// route "<id>" { match { arm { patterns target } } }
// ─────────────────────────────────────────────────────────────────────────────

func routeSchema() *schema.BlockSchema {
	return &schema.BlockSchema{
		Labels: []*schema.LabelSchema{{Name: "id"}},
		Body: &schema.BodySchema{
			Blocks: map[string]*schema.BlockSchema{
				"match": {
					MaxItems: 1,
					Body: &schema.BodySchema{
						Blocks: map[string]*schema.BlockSchema{
							"arm": {
								Body: &schema.BodySchema{
									Attributes: map[string]*schema.AttributeSchema{
										"patterns": {IsRequired: true, Constraint: schema.AnyExpression{OfType: cty.List(cty.String)}},
										"target":   {IsRequired: true, Constraint: schema.LiteralType{Type: cty.String}},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}
