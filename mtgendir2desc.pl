#! /usr/bin/env perl

use strict;
use warnings;

use JSON;

# give it the location of the source directory of the mtgen project
# as the first argument, and the location of mtgjson's AllSets-x.json
# as the second
my ($mtgen_dir, $mtgjson_file) = @ARGV;
$mtgen_dir .= '/src/mtgen';

undef $/;

my $mtgjson = load_json_file($mtgjson_file);
my $mtgjson_idx = index_mtgjson($mtgjson);

my %retval;

my $sets_json = load_sets_json("$mtgen_dir/wwwroot");

my $set_meta_dir = "$mtgen_dir/Views/Set";

opendir(my $dh, $set_meta_dir) or die "can't opendir $set_meta_dir: $!";
foreach my $file (readdir $dh) {
	if($file =~ /\.json$/ && -f "$set_meta_dir/$file") {
		my $set = $file;
		$set =~ s/\.json$//;
		my $data = process_set("$set_meta_dir/$file", "$mtgen_dir", $set, $sets_json, $mtgjson_idx);
		$retval{$set} = $data if($data);
	}
}
close($dh);

print to_json(\%retval, { pretty => 1 });

sub load_json_file {
	my ($fname) = @_;
	
	open(my $fh, $fname) or
		die "can't open $fname: $!";
	
	my $contents = <$fh>;
	# some files contain the UTF8 BOM, don't want it
	$contents =~ s/^\xef\xbb\xbf//; 
	my $data = from_json($contents);

	close($fh);

	return $data;
}

sub process_set {
	my ($meta_file, $mtgen_dir, $setcode, $sets_json, $mtgjson_idx) = @_;
	my $dir = "$mtgen_dir/wwwroot/$setcode";

	my $meta_json = load_json_file($meta_file);
# XXX: finished here

	my ($packs, $defs) = get_packs_and_defs($dir, $meta_json);

	if(scalar(keys %$packs) == 0) {
		return undef;
	}

	return { 
		cards => get_cards($dir, get_cardfiles($meta_json), $mtgjson_idx),
		packs => $packs,
		defs => $defs,
		date => get_packdate($setcode, $sets_json),
	};
}

sub get_cardfiles {
	my ($meta_json) = @_;

	my @rv = @{ $meta_json->{CardFiles} };

	return [ sort @rv ];
}

sub get_cards {
	my ($dir, $cardfiles, $mtgjson_idx) = @_;

	my @cards;
	foreach my $cardf (@$cardfiles) {
		push @cards, @{ load_json_file("$dir/$cardf") };
	}

	foreach my $card (@cards) {
		my $lcset = lc($card->{set});
		if(exists($mtgjson_idx->{$lcset})) {
			$card->{mtgjson} = $mtgjson_idx->{$lcset}->{lc($card->{title})};
		} else {
			print STDERR "couldn't find this set in mtgjson: $lcset\n";
		}
	}

	return \@cards;
}

sub get_packs_and_defs {
	my ($dir, $meta_json) = @_;
	
	my (%packs, @defs);

	foreach my $packfile (map { load_json_file("$dir/$_") } @{ $meta_json->{PackFiles} }) {
		foreach my $pack (@{ $packfile->{packs}}) {
			$packs{$pack->{packName}} = $pack;
		}
		foreach my $def (@{ $packfile->{defs} }) {
			die "oops" if(exists($def->{querySet}));
			die "oops2" unless(exists($def->{query}));
			push @defs, $def;
		}
	}

	return (\%packs, \@defs);
}

sub load_sets_json {
	my ($dir) = @_;

	return load_json_file("$dir/sets.json");
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

sub index_mtgjson {
	my ($mj) = @_;

	my %idx;

	foreach my $set (keys %{ $mj }) {
		foreach my $card (@{ $mj->{$set}->{cards} }) {
			# to keep the file a bit smaller
			delete $card->{legalities};
			delete $card->{foreignNames};

			$idx{lc($set)}->{lc($card->{name})} = $card;
		}
	}

	return \%idx;
}
