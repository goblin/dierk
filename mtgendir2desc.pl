#! /usr/bin/env perl

use strict;
use warnings;

use JSON;

# give it the location of the wwwroot directory in the mtgen project
# as an argument
my $mtgen_dir = shift @ARGV;

undef $/;

my %retval;

my $sets = load_sets($mtgen_dir);

opendir(my $dh, $mtgen_dir) or die "can't opendir $mtgen_dir: $!";
foreach my $dir (readdir $dh) {
	if(-d "$mtgen_dir/$dir" 
			&& -f "$mtgen_dir/$dir/packs.json"
			&& -f "$mtgen_dir/$dir/products.json") {
		my $data = process_dir("$mtgen_dir/$dir", $dir, $sets);
		$retval{$dir} = $data if($data);
	}
}
close($dh);

print to_json(\%retval, { pretty => 1 });

sub process_dir {
	my ($dir, $code, $sets) = @_;

	my $packs = get_packs($dir);

	if(scalar(keys %$packs) == 0) {
		return undef;
	}

	return { 
		cards => get_cards($dir, get_cardfiles($dir)),
		packs => $packs,
		date => get_packdate($code, $sets),
	};
}

sub get_cardfiles {
	my ($dir) = @_;

	my @rv;

	opendir(my $dh, $dir) or die "can't open subdir $dir: $!";
	foreach my $file (readdir $dh) {
		if($file =~ /^(cards.*\.json)$/) {
			push @rv, $1;
		}
	}
	closedir($dh);

	return [ sort @rv ];
}

sub get_cards {
	my ($dir, $cardfiles) = @_;

	my @cards;
	foreach my $cardf (@$cardfiles) {
		open(my $cfh, "$dir/$cardf") or die "can't open $dir/$cardf: $!";
		my $card_data = <$cfh>;
		# some cardsfiles contain the UTF8 BOM, don't want it
		$card_data =~ s/^\xef\xbb\xbf//; 

		push @cards, @{ from_json($card_data) };
		close($cfh);
	}

	return \@cards;
}

sub get_packs {
	my ($dir) = @_;

	open(my $prodh, "$dir/products.json") or 
		die "can't open $dir/products.json: $!";
	my $products = from_json(<$prodh>);
	close($prodh);

	my %packs;
	foreach my $prod (@{ $products->{products} }) {
		my $vis = 1;
		if(exists($prod->{isVisible}) && !$prod->{isVisible}) {
			$vis = 0;
		}
		if($prod->{isGenerated} 
				&& $vis
				&& scalar(@{ $prod->{packs} }) == 1) {
			my $packname = $prod->{packs}->[0]->{packName};
			$packs{$packname} = {
				prod_desc => $prod->{productDesc},
				pack => get_pack($dir, $packname),
			};
		}
	}

	return \%packs;
}

sub get_pack {
	my ($dir, $name) = @_;

	open(my $packh, "$dir/packs.json") or
		die "can't open $dir/packs.json: $!";
	my $packs = from_json(<$packh>);
	close($packh);

	foreach my $pack (@{ $packs->{packs}}) {
		if($pack->{packName} eq $name) {
			return {
				defs => $packs->{defs},
				pack => $pack
			};
		}
	}
	return undef;
}

sub load_sets {
	my ($dir) = @_;

	open(my $seth, "$dir/sets.json") or
		die "can't open $dir/sets.json: $!";
	my $sets = from_json(<$seth>);
	close($seth);

	return $sets;
}

sub get_packdate {
	my ($dir, $sets) = @_;

	foreach my $set (@$sets) {
		if(lc($set->{code}) eq lc($dir)) {
			return $set->{releaseDate};
		}
	}

	return undef;
}
